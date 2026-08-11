import * as cheerio from "cheerio";
import { writeFile } from "node:fs/promises";

const MONTHS = {
  January: "01",
  February: "02",
  March: "03",
  April: "04",
  May: "05",
  June: "06",
  July: "07",
  August: "08",
  September: "09",
  October: "10",
  November: "11",
  December: "12"
};

function parseDuration(duration) {
  const parts = duration.split(/\s+-\s+/);

  if (parts.length !== 2) {
    throw new Error(`Unexpected duration format: "${duration}"`);
  }

  let [start, end] = parts;

  // Remove ordinal suffixes such as 1st, 2nd, 3rd, 4th.
  // Also tolerates malformed values such as "7h".
  start = start.replace(/(\d+)[a-z]+/gi, "$1").trim();
  end = end.replace(/(\d+)[a-z]+/gi, "$1").trim();

  // If the start date has no year, use the end date's year.
  const endYear = end.match(/\b(\d{4})\b/)?.[1];

  if (!endYear) {
    throw new Error(`Could not find year in end date: "${end}"`);
  }

  if (!/\b\d{4}\b/.test(start)) {
    start = `${start} ${endYear}`;
  }

  return {
    startDate: formatDate(start),
    endDate: formatDate(end)
  };
}

function formatDate(dateString) {
  const match = dateString.match(
    /^([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})$/
  );

  if (!match) {
    throw new Error(`Could not parse date: "${dateString}"`);
  }

  const [, monthName, dayString, year] = match;
  const month = MONTHS[monthName];

  if (!month) {
    throw new Error(`Unknown month: "${monthName}"`);
  }

  const day = Number(dayString);

  if (day < 1 || day > 31) {
    throw new Error(`Invalid day: "${dayString}"`);
  }

  const date = new Date(
    Number(year),
    Number(month) - 1,
    day
  );

  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== day
  ) {
    throw new Error(`Invalid date: "${dateString}"`);
  }

  return `${year}-${month}-${dayString.padStart(2, "0")}`;
}

function toPtcgpDate(dateString) {
    return new Date(`${dateString}T06:00:00.000Z`);
}

function getActiveEvents(events) {
    const now = new Date();

    return events.filter(event =>
        event.startDate <= now && now < event.endDate
    );
}

function addEventFlags(events) {
    const now = new Date();
    const oneDay = 24 * 60 * 60 * 1000;

    return events.map(event => {
        const isNew = now - event.startDate < oneDay;
        const endingSoon = event.endDate - now < oneDay;

        return {
            ...event,
            isNew,
            endingSoon
        };
    });
}

function getNextShopRefresh() {
    const now = new Date();

    const nextRefresh = new Date(
        Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth() + 1,
            1,
            6, 0, 0, 0
        )
    );

    return {
        date: nextRefresh
    };
}

const SOURCE_HOST = "https://www.serebii.net";
const SOURCE_PATH = "/tcgpocket/events.shtml";
const SOURCE_URL = `${SOURCE_HOST}${SOURCE_PATH}`

console.log("Scraper starting...");

const response = await fetch(SOURCE_URL);

if (!response.ok) {
    throw new Error(`Failed to fetch page: ${response.status} ${response.statusText}`);
}

const html = await response.text();
const $ = cheerio.load(html);

// Find the first table.dextab after the first h1
const table = $("h1").first().nextAll("table.dextab").first();

if (table.length === 0) {
    throw new Error("Could not find the events table");
}

const events = [];

table.find("tbody tr").each((index, row) => {
    if (index === 0) return;

    const cells = $(row).find("td");

    const imageSrc = $(cells[0]).find("img").attr("src");
    const image = imageSrc ? new URL(imageSrc, SOURCE_HOST).href : undefined;

    const title = $(cells[1]).text().trim();
    const duration = $(cells[2]).text().trim();

    try {
      const dates = parseDuration(duration);

      events.push({
          title,
          image,
          startDate: toPtcgpDate(dates.startDate),
          endDate: toPtcgpDate(dates.endDate)
      });
    } catch (error) {
      console.warn(`Skipping "${title}": ${error.message}`);
    }
});

const activeEvents = addEventFlags(getActiveEvents(events));
const shopRefresh = getNextShopRefresh();

const output = {
    source: SOURCE_URL,
    scrapedAt: new Date().toISOString(),
    nextShopRefresh: shopRefresh.date,
    eventCount: activeEvents.length,
    events: activeEvents
};

await writeFile(
    "events.json",
    JSON.stringify(output, null, 2)
);

console.log(`Saved ${events.length} events to events.json`);
