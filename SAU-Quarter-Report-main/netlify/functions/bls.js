const CORS_HEADERS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

const BLS_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/";

const INDUSTRIES = {
  construction: { code: "15", label: "Mining, Logging & Construction" },
  manufacturing: { code: "30", label: "Manufacturing" },
  tradeTransportationUtilities: { code: "40", label: "Trade, Transportation & Utilities" },
  information: { code: "50", label: "Information" },
  financialActivities: { code: "55", label: "Financial Activities" },
  professionalBusinessServices: { code: "60", label: "Professional & Business Services" },
  educationHealthServices: { code: "65", label: "Education & Health Services" },
  leisureHospitality: { code: "70", label: "Leisure & Hospitality" },
  otherServices: { code: "80", label: "Other Services" },
  government: { code: "90", label: "Government" }
};

// BLS metropolitan area codes. LAUS and CES IDs below are generated from these
// area codes using the same BLS series structure used by the original Austin dashboard.
const MARKETS = {
  austin: {
    shortName: "Austin",
    name: "Austin-Round Rock-San Marcos, TX",
    areaCode: "12420"
  },
  dallas: {
    shortName: "Dallas–Fort Worth",
    name: "Dallas-Fort Worth-Arlington, TX",
    areaCode: "19100"
  },
  houston: {
    shortName: "Houston",
    name: "Houston-Pasadena-The Woodlands, TX",
    areaCode: "26420"
  },
  sanAntonio: {
    shortName: "San Antonio",
    name: "San Antonio-New Braunfels, TX",
    areaCode: "41700"
  }
};

function seriesConfig(market) {
  const prefix = `48${market.areaCode}`;
  const industries = Object.fromEntries(
    Object.entries(INDUSTRIES).map(([key, config]) => [
      key,
      {
        id: `SMU${prefix}${config.code}00000001`,
        label: config.label
      }
    ])
  );

  return {
    laborForce: `LAUMT${prefix}00000006`,
    employment: `LAUMT${prefix}00000005`,
    unemploymentRate: `LAUMT${prefix}00000003`,
    totalNonfarm: `SMU${prefix}0000000001`,
    industries
  };
}

function normalizeSeries(raw, label) {
  return (raw?.data || [])
    .filter(d => /^M\d{2}$/.test(d.period))
    .map(d => ({
      year: Number(d.year),
      period: d.period,
      periodName: d.periodName,
      value: Number(String(d.value).replace(/,/g, "")),
      preliminary: Array.isArray(d.footnotes) && d.footnotes.some(f => /preliminary/i.test(f?.text || "")),
      label
    }))
    .filter(d => Number.isFinite(d.value));
}

function buildMarketResult(key, market, series, rawById) {
  const industries = {};
  for (const [industryKey, config] of Object.entries(series.industries)) {
    industries[industryKey] = normalizeSeries(rawById[config.id], config.label);
  }

  return {
    meta: {
      key,
      shortName: market.shortName,
      area: market.name
    },
    series: {
      laborForce: normalizeSeries(rawById[series.laborForce], "Civilian Labor Force"),
      employment: normalizeSeries(rawById[series.employment], "Employment"),
      unemploymentRate: normalizeSeries(rawById[series.unemploymentRate], "Unemployment Rate"),
      totalNonfarm: normalizeSeries(rawById[series.totalNonfarm], "Total Nonfarm"),
      industries
    }
  };
}

exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  const apiKey = process.env.BLS_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing BLS_API_KEY environment variable in Netlify." })
    };
  }

  const market1Key = event.queryStringParameters?.market1 || "austin";
  const market2Key = event.queryStringParameters?.market2 || "dallas";

  if (!MARKETS[market1Key] || !MARKETS[market2Key]) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Unknown market selection." })
    };
  }
  if (market1Key === market2Key) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Please select two different markets." })
    };
  }

  const selected = [
    [market1Key, MARKETS[market1Key]],
    [market2Key, MARKETS[market2Key]]
  ];
  const configs = selected.map(([key, market]) => [key, market, seriesConfig(market)]);
  const seriesIds = configs.flatMap(([, , s]) => [
    s.laborForce,
    s.employment,
    s.unemploymentRate,
    s.totalNonfarm,
    ...Object.values(s.industries).map(v => v.id)
  ]);

  const currentYear = new Date().getUTCFullYear();
  const startYear = currentYear - 5;

  try {
    const blsResponse = await fetch(BLS_URL, {
      method: "POST",
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({
        seriesid: seriesIds,
        startyear: String(startYear),
        endyear: String(currentYear),
        registrationkey: apiKey
      })
    });

    if (!blsResponse.ok) throw new Error(`BLS HTTP ${blsResponse.status}`);
    const json = await blsResponse.json();
    if (json.status !== "REQUEST_SUCCEEDED") {
      throw new Error((json.message || []).join(" ") || "BLS request failed.");
    }

    const rawById = Object.fromEntries((json.Results?.series || []).map(s => [s.seriesID, s]));
    const markets = configs.map(([key, market, s]) => buildMarketResult(key, market, s, rawById));

    for (const market of markets) {
      if (!market.series.totalNonfarm.length || !market.series.unemploymentRate.length) {
        throw new Error(`BLS returned no usable required data for ${market.meta.shortName}.`);
      }
    }

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
          startYear,
          endYear: currentYear,
          source: "U.S. Bureau of Labor Statistics"
        },
        markets
      })
    };
  } catch (error) {
    console.error("BLS function error:", error);
    return {
      statusCode: 502,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: `Unable to retrieve BLS data: ${error.message}` })
    };
  }
};

