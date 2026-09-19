// api/dashboard.js
// Función serverless de Vercel (Node.js) que descarga el CSV publicado de
// Google Sheets, lo parsea y lo devuelve como JSON.
//
// La URL es pública (hoja publicada con "Publicar en la web"), por lo que
// no requiere token ni variable de entorno: se puede escribir directamente
// en el código sin exponer ningún dato sensible.

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSHeo2vGHvzCsE-NBhMEtpQaI4kZJtSLupAlSNKAFv-kx4OwYDTvLIkXGw0InmT1HQDJklx5rg188y0/pub?output=csv";

/**
 * Parser de CSV que respeta RFC 4180: soporta comas dentro de campos
 * entre comillas dobles y comillas dobles escapadas ("").
 * Devuelve un arreglo de filas, cada fila es un arreglo de strings.
 */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  // Normaliza saltos de línea de Windows/Mac a \n
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const next = normalized[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++; // saltar la comilla escapada
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += char;
      }
    }
  }

  // Empujar el último campo/fila si el archivo no termina en \n
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Filtrar filas totalmente vacías
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/**
 * Convierte una fecha en formato M/D/YYYY (o M/D/YY) a un string ISO
 * (YYYY-MM-DD). Si no puede parsear, devuelve el valor original como texto.
 */
function parseFecha(value) {
  if (!value) return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return trimmed || null;

  let [, month, day, year] = match;
  if (year.length === 2) {
    year = `20${year}`;
  }
  month = month.padStart(2, "0");
  day = day.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/**
 * Convierte las filas crudas del CSV en un arreglo de objetos tipados,
 * respetando el orden y tipo de columna:
 *   NOMBRE (número de registro) -> number
 *   FECHA                       -> string ISO (YYYY-MM-DD)
 *   FACTUR                      -> number
 *   ESTADO                      -> string
 *   OBSERVACION                 -> string
 */
function rowsToFacturas(rows) {
  if (rows.length === 0) return [];

  // La primera fila es el encabezado; se descarta porque ya conocemos
  // el orden y tipo de cada columna.
  const dataRows = rows.slice(1);

  return dataRows.map((cols) => {
    const [nombreRaw, fechaRaw, facturRaw, estadoRaw, observacionRaw] = cols;

    const nombreNum = Number(nombreRaw);
    const facturNum = Number(facturRaw);

    return {
      nombre: Number.isFinite(nombreNum) ? nombreNum : nombreRaw || null,
      fecha: parseFecha(fechaRaw),
      factura: Number.isFinite(facturNum) ? facturNum : facturRaw || null,
      estado: (estadoRaw || "").trim(),
      observacion: (observacionRaw || "").trim(),
    };
  });
}

module.exports = async (req, res) => {
  // Cabeceras CORS: el frontend puede llamar esta función desde cualquier
  // origen (incluido el navegador servido por el mismo proyecto de Vercel).
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  try {
    const response = await fetch(CSV_URL, {
      headers: { "cache-control": "no-cache" },
    });

    if (!response.ok) {
      throw new Error(
        `No se pudo descargar el CSV publicado (status ${response.status}).`
      );
    }

    const csvText = await response.text();
    const rows = parseCSV(csvText);
    const facturas = rowsToFacturas(rows);

    res.status(200).json({
      success: true,
      syncedAt: new Date().toISOString(),
      total: facturas.length,
      facturas,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      syncedAt: new Date().toISOString(),
      total: 0,
      facturas: [],
      error: error.message || "Error desconocido al sincronizar el CSV.",
    });
  }
};
