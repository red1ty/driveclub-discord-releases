// Posts a GitHub release of driveclub-recomp to the Discord #releases webhook.
//
// Env:
//   DISCORD_WEBHOOK_URL  required unless DRY_RUN=1
//   WATCH=1              post every release newer than state/last-tag.txt, then update that file
//   RELEASE_TAG          tag to post (default: latest release; ignored with WATCH)
//   RELEASE_PING_ROLE    Discord role id to ping (optional)
//   GITHUB_TOKEN         optional, raises the GitHub API rate limit
//   DRY_RUN=1            print the payload instead of posting
//   OUT_FILE             with DRY_RUN, write the payload here

import { readFileSync, writeFileSync } from "node:fs";

const STATE_FILE = new URL("./state/last-tag.txt", import.meta.url);

const REPO = process.env.SOURCE_REPO || "OverkillLabs3/driveclub-recomp";
const CHANNELS = {
  startHere: "1563589651871039712",
  setupHelp: "1563588370347855932",
  bugReports: "1563586517228593152",
};
const DESCRIPTION_LIMIT = 4000;

async function gh(path) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "driveclub-release-bot" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// Text between a heading line and the next heading of the same or higher level.
function section(body, heading) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return "";
  const level = heading.match(/^#+/)[0].length;
  const out = [];
  for (const line of lines.slice(start + 1)) {
    const m = line.match(/^(#+)\s/);
    if (m && m[1].length <= level) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

// Discord embeds render headings inconsistently, so sub-headings become bold lines.
const tidy = (text) => text.replace(/^#{3,6}\s+(.*)$/gm, "**$1**").replace(/\n{3,}/g, "\n\n");

function clip(text, limit, url) {
  if (text.length <= limit) return text;
  const more = `\n\n… [Read the full release notes](${url})`;
  const cut = text.slice(0, limit - more.length);
  return cut.slice(0, cut.lastIndexOf("\n")) + more;
}

export async function buildPayload(release) {
  const version = release.tag_name.replace(/^v/, "");
  const body = release.body || "";
  const highlights = section(body, `## Highlights of ${version}`);
  const changes = section(body, `### ${version}`);

  let description = "";
  if (highlights) description += tidy(highlights) + "\n\n";
  if (changes) description += `**What changed in ${version}**\n` + tidy(changes);
  if (!description) description = tidy(body);
  description = clip(description.trim(), DESCRIPTION_LIMIT, release.html_url);

  const zip = release.assets.find((a) => /win64\.zip$/i.test(a.name)) || release.assets[0];
  const sha = zip && (body.match(new RegExp("`([0-9a-f]{64})`\\s+`" + zip.name.replace(/\./g, "\\.") + "`")) || [])[1];

  const fields = [];
  if (zip) fields.push({ name: "Download", value: `[${zip.name}](${zip.browser_download_url}) (${Math.round(zip.size / 1048576)} MB)` });
  if (sha) fields.push({ name: "SHA-256", value: "`" + sha + "`" });
  fields.push({
    name: "New here?",
    value: `Read <#${CHANNELS.startHere}>. Stuck? <#${CHANNELS.setupHelp}>. Found a bug? <#${CHANNELS.bugReports}> with your logs.`,
  });

  const role = process.env.RELEASE_PING_ROLE;
  return {
    username: "Driveclub Releases",
    avatar_url: "https://github.com/OverkillLabs3.png",
    content: `${role ? `<@&${role}> ` : ""}🏁 **${release.name || release.tag_name}** is out!`,
    allowed_mentions: { parse: [], roles: role ? [role] : [] },
    embeds: [{
      title: release.name || release.tag_name,
      url: release.html_url,
      description,
      color: 0xe74c3c,
      author: { name: REPO, url: `https://github.com/${REPO}`, icon_url: "https://github.com/OverkillLabs3.png" },
      fields,
      footer: { text: "Bring your own legally dumped copy of DriveClub v1.28. No game files are shared here." },
      timestamp: release.published_at,
    }],
  };
}

async function post(release) {
  const payload = await buildPayload(release);

  if (process.env.DRY_RUN) {
    const json = JSON.stringify(payload, null, 2);
    if (process.env.OUT_FILE) writeFileSync(process.env.OUT_FILE, json);
    console.log(`[dry run] ${release.tag_name}: description ${payload.embeds[0].description.length} chars, ${payload.embeds[0].fields.length} fields`);
    return;
  }

  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) throw new Error("DISCORD_WEBHOOK_URL is not set");
  const res = await fetch(`${url}?wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Discord: ${res.status} ${await res.text()}`);
  const msg = await res.json();
  console.log(`Posted ${release.tag_name} as message ${msg.id}`);
}

// Releases published after the last posted tag, oldest first. If the last tag
// is no longer in the list, only the newest release is posted, never a backlog.
async function newReleases() {
  const last = readFileSync(STATE_FILE, "utf8").trim();
  const releases = (await gh("releases?per_page=30")).filter((r) => !r.draft && !r.prerelease);
  const idx = releases.findIndex((r) => r.tag_name === last);
  if (idx === 0 || !releases.length) return [];
  return (idx === -1 ? releases.slice(0, 1) : releases.slice(0, idx)).reverse();
}

async function main() {
  if (!process.env.WATCH) {
    const tag = process.env.RELEASE_TAG;
    await post(await gh(tag ? `releases/tags/${encodeURIComponent(tag)}` : "releases/latest"));
    return;
  }

  const fresh = await newReleases();
  if (!fresh.length) { console.log("No new releases."); return; }
  for (const release of fresh) {
    await post(release);
    if (!process.env.DRY_RUN) writeFileSync(STATE_FILE, release.tag_name + "\n");
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
