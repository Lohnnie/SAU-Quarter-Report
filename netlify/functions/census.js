const CORS_HEADERS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

const CENSUS_BASE = "https://api.census.gov/data";
const CURRENT_ACS_YEAR = 2024;
const BASE_ACS_YEAR = 2019;
const GEO_NAME = "metropolitan statistical area/micropolitan statistical area";

const MARKETS = {
  austin: { shortName: "Austin", name: "Austin-Round Rock-San Marcos, TX", cbsa: "12420" },
  dallas: { shortName: "Dallas–Fort Worth", name: "Dallas-Fort Worth-Arlington, TX", cbsa: "19100" },
  houston: { shortName: "Houston", name: "Houston-Pasadena-The Woodlands, TX", cbsa: "26420" },
  sanAntonio: { shortName: "San Antonio", name: "San Antonio-New Braunfels, TX", cbsa: "41700" }
};

const VARIABLES = [
  "NAME",
  "B01003_001E", // Total population
  "B19013_001E", // Median household income
  "B15003_001E", // Population age 25+
  "B15003_022E", // Bachelor's degree
  "B15003_023E", // Master's degree
  "B15003_024E", // Professional school degree
  "B15003_025E"  // Doctorate degree
];

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > -600000000 ? n : null;
}

async function fetchAcs(year, cbsa, apiKey) {
  const url = new URL(`${CENSUS_BASE}/${year}/acs/acs1`);
  url.searchParams.set("get", VARIABLES.join(","));
  url.searchParams.set("for", `${GEO_NAME}:${cbsa}`);
  url.searchParams.set("key", apiKey);

  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Census HTTP ${response.status}: ${body.slice(0, 180)}`);
  }

  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new Error(`Census returned no ACS ${year} data for CBSA ${cbsa}.`);
  }

  const [headers, values] = rows;
  return Object.fromEntries(headers.map((header, i) => [header, values[i]]));
}

function buildMetrics(current, base) {
  const population = numberOrNull(current.B01003_001E);
  const basePopulation = numberOrNull(base.B01003_001E);
  const medianHouseholdIncome = numberOrNull(current.B19013_001E);
  const age25Plus = numberOrNull(current.B15003_001E);
  const bachelorsPlusCount = ["B15003_022E", "B15003_023E", "B15003_024E", "B15003_025E"]
    .map(key => numberOrNull(current[key]))
    .reduce((sum, value) => sum + (value || 0), 0);

  return {
    population,
    basePopulation,
    populationGrowth5yr: population && basePopulation
      ? ((population / basePopulation) - 1) * 100
      : null,
    medianHouseholdIncome,
    bachelorsOrHigherPct: age25Plus && bachelorsPlusCount
      ? (bachelorsPlusCount / age25Plus) * 100
      : null
  };
}

exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  const apiKey = process.env.CENSUS_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing CENSUS_API_KEY environment variable in Netlify." })
    };
  }

  const market1Key = event.queryStringParameters?.market1 || "austin";
  const market2Key = event.queryStringParameters?.market2 || "dallas";

  if (!MARKETS[market1Key] || !MARKETS[market2Key]) {
    return { statusCode: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Unknown market selection." }) };
  }
  if (market1Key === market2Key) {
    return { statusCode: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Please select two different markets." }) };
  }

  try {
    const selected = [market1Key, market2Key];
    const results = await Promise.all(selected.map(async key => {
      const market = MARKETS[key];
      const [current, base] = await Promise.all([
        fetchAcs(CURRENT_ACS_YEAR, market.cbsa, apiKey),
        fetchAcs(BASE_ACS_YEAR, market.cbsa, apiKey)
      ]);

      return {
        meta: { key, shortName: market.shortName, area: market.name, cbsa: market.cbsa },
        metrics: buildMetrics(current, base)
      };
    }));

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600, s-maxage=21600"
      },
      body: JSON.stringify({
        meta: {
          fetchedAt: new Date().toISOString(),
          source: "U.S. Census Bureau, American Community Survey 1-Year Estimates",
          currentYear: CURRENT_ACS_YEAR,
          baseYear: BASE_ACS_YEAR
        },
        markets: results
      })
    };
  } catch (error) {
    console.error("Census function error:", error);
    return {
      statusCode: 502,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: `Unable to retrieve Census data: ${error.message}` })
    };
  }
};
