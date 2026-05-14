// Fetches blog posts from the Notion "Posts" collection and converts them to
// Markdown files in ../posts/. Also downloads any embedded images into
// ../assets/posts/. Run once with `node scripts/fetch-posts.mjs`.

import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const POSTS_DIR = path.join(ROOT, "posts");
const ASSETS_DIR = path.join(ROOT, "assets", "posts");

const SITE = "https://alextarasiuk.notion.site";
const SPACE_ID = "0580a767-d7ff-486b-9d2d-23027a9cac6a";
const POSTS_COLLECTION_ID = "0459771f-9021-439a-ba05-cb5667d75580";
const POSTS_VIEW_ID = "151c0506-9115-4f25-8709-25d5c1c71b4e";

// Property schema for the Posts collection (from the page's collection record).
const SCHEMA = {
    "Z]mk": "Published",
    "_Z\\h": "TLDR",
    "\\]EP": "Slug",
    title: "Name",
};

async function ensureDir(dir) {
    await fs.mkdir(dir, { recursive: true });
}

async function apiPost(endpoint, body) {
    const res = await fetch(`${SITE}/api/v3/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`${endpoint} ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
}

async function loadPageChunk(pageId, chunkNumber = 0, stack = []) {
    return apiPost("loadCachedPageChunkV2", {
        pageId,
        limit: 200,
        cursor: { stack },
        chunkNumber,
        verticalColumns: false,
    });
}

async function queryCollection() {
    return apiPost("queryCollection", {
        source: {
            type: "collection",
            id: POSTS_COLLECTION_ID,
            spaceId: SPACE_ID,
        },
        collectionView: { id: POSTS_VIEW_ID, spaceId: SPACE_ID },
        loader: {
            type: "reducer",
            reducers: {
                collection_group_results: {
                    type: "results",
                    limit: 200,
                    loadContentCover: true,
                },
            },
            userTimeZone: "America/Mexico_City",
            sort: [{ property: "Z]mk", direction: "descending" }],
            searchQuery: "",
        },
    });
}

function slugify(s) {
    return s
        .toString()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/['"]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
}

function escapeMd(s) {
    return s.replace(/([\\*_`~])/g, "\\$1");
}

// Render a Notion rich-text array (the [["text", [["b"], ["a","url"]]], ...] shape) to markdown.
function renderRichText(arr) {
    if (!Array.isArray(arr)) return "";
    let out = "";
    for (const seg of arr) {
        let text = seg[0] || "";
        const fmts = seg[1] || [];
        if (text === "⁠") continue;
        // Inline mention/equation/etc are usually represented as a single bullet char.
        let prefix = "";
        let suffix = "";
        for (const fmt of fmts) {
            const kind = fmt[0];
            if (kind === "b") {
                prefix = `**` + prefix;
                suffix = suffix + `**`;
            } else if (kind === "i") {
                prefix = `*` + prefix;
                suffix = suffix + `*`;
            } else if (kind === "c") {
                prefix = "`" + prefix;
                suffix = suffix + "`";
            } else if (kind === "s") {
                prefix = `~~` + prefix;
                suffix = suffix + `~~`;
            } else if (kind === "_") {
                // Underline – markdown has no native, fall through.
            } else if (kind === "a") {
                const url = fmt[1] || "";
                // Defer link wrap until after styling.
                prefix = `[` + prefix;
                suffix = suffix + `](${url})`;
            }
        }
        out += prefix + text + suffix;
    }
    return out;
}

function plainText(arr) {
    if (!Array.isArray(arr)) return "";
    return arr.map((s) => s[0] || "").join("");
}

function notionDateText(dateProp) {
    // The "date" property value is stored as e.g. [["‣", [["d", {"type":"date","start_date":"2021-06-21"}]]]]
    if (!Array.isArray(dateProp)) return "";
    for (const seg of dateProp) {
        const fmts = seg[1] || [];
        for (const fmt of fmts) {
            if (fmt[0] === "d" && fmt[1]?.start_date) return fmt[1].start_date;
        }
    }
    return "";
}

// Convert one block (resolved via blockMap) to markdown lines.
// Returns an array of strings (each line will be joined with \n).
async function blockToMd(blockId, blockMap, ctx, depth = 0) {
    const wrapped = blockMap[blockId];
    if (!wrapped) return [];
    const block = wrapped.value?.value;
    if (!block || block.alive === false) return [];

    const { type, properties = {}, format = {}, content = [] } = block;
    const lines = [];
    const indent = "    ".repeat(depth);

    switch (type) {
        case "text": {
            const t = renderRichText(properties.title || []);
            lines.push(indent + (t || ""));
            break;
        }
        case "header":
            lines.push(`${indent}# ` + renderRichText(properties.title || []));
            break;
        case "sub_header":
            lines.push(`${indent}## ` + renderRichText(properties.title || []));
            break;
        case "sub_sub_header":
            lines.push(`${indent}### ` + renderRichText(properties.title || []));
            break;
        case "bulleted_list_item":
        case "bulleted_list":
            lines.push(`${indent}- ` + renderRichText(properties.title || []));
            break;
        case "numbered_list_item":
        case "numbered_list":
            lines.push(`${indent}1. ` + renderRichText(properties.title || []));
            break;
        case "to_do": {
            const done = properties.checked?.[0]?.[0] === "Yes";
            lines.push(`${indent}- [${done ? "x" : " "}] ` + renderRichText(properties.title || []));
            break;
        }
        case "quote":
            lines.push(`${indent}> ` + renderRichText(properties.title || []));
            break;
        case "code": {
            const lang = (properties.language?.[0]?.[0] || "").toLowerCase();
            lines.push(`${indent}\`\`\`${lang}`);
            lines.push(plainText(properties.title || []));
            lines.push(`${indent}\`\`\``);
            break;
        }
        case "divider":
            lines.push(`${indent}---`);
            break;
        case "callout": {
            const emoji = format.page_icon || "💡";
            const body = renderRichText(properties.title || []);
            lines.push(`${indent}> ${emoji} ${body}`);
            break;
        }
        case "toggle": {
            const summary = renderRichText(properties.title || []);
            lines.push(`${indent}<details><summary>${summary}</summary>\n`);
            for (const child of content) {
                const childLines = await blockToMd(child, blockMap, ctx, depth);
                lines.push(...childLines);
            }
            lines.push(`${indent}</details>`);
            return lines;
        }
        case "image": {
            const src = properties.source?.[0]?.[0] || format.display_source;
            const caption = renderRichText(properties.caption || []);
            if (src) {
                const local = await downloadImage(src, block.id, ctx);
                lines.push(`${indent}![${caption || ""}](${local})`);
                if (caption) lines.push(`${indent}*${caption}*`);
            }
            break;
        }
        case "video":
        case "embed":
        case "bookmark": {
            const src = properties.link?.[0]?.[0] || properties.source?.[0]?.[0];
            if (src) lines.push(`${indent}[${src}](${src})`);
            break;
        }
        case "tweet": {
            const src = properties.source?.[0]?.[0];
            if (src) lines.push(`${indent}[${src}](${src})`);
            break;
        }
        case "equation": {
            const eq = plainText(properties.title || []);
            lines.push(`${indent}$$${eq}$$`);
            break;
        }
        case "column_list":
        case "column": {
            // Flatten columns – we don't preserve layout in markdown.
            for (const child of content) {
                const childLines = await blockToMd(child, blockMap, ctx, depth);
                lines.push(...childLines);
            }
            return lines;
        }
        case "page": {
            // sub-page link
            const title = plainText(properties?.title || []) || "Untitled";
            lines.push(`${indent}- [${title}](#)`);
            break;
        }
        default:
            // Fall back: just emit the title text if present.
            if (properties.title) {
                lines.push(indent + renderRichText(properties.title));
            }
            break;
    }

    // Recurse into children for list-style and other containers.
    if (
        content.length &&
        (type === "bulleted_list_item" ||
            type === "numbered_list_item" ||
            type === "to_do" ||
            type === "toggle" ||
            type === "quote" ||
            type === "callout")
    ) {
        for (const child of content) {
            const childLines = await blockToMd(child, blockMap, ctx, depth + 1);
            lines.push(...childLines);
        }
    }
    return lines;
}

async function downloadImage(src, blockId, ctx) {
    // Skip non-Notion images – just keep the absolute URL.
    if (!/secure\.notion-static\.com|prod-files-secure|notion\.so\/image/.test(src)) {
        return src;
    }

    const fileName = (() => {
        try {
            const url = new URL(src);
            return path.basename(url.pathname);
        } catch {
            return `${blockId}.bin`;
        }
    })();
    const safeName = `${blockId.slice(0, 8)}-${fileName}`.replace(/[^a-zA-Z0-9._-]/g, "_");
    const outDir = path.join(ASSETS_DIR, ctx.slug);
    await ensureDir(outDir);
    const outPath = path.join(outDir, safeName);
    if (fssync.existsSync(outPath)) {
        return path.posix.join("..", "assets", "posts", ctx.slug, safeName);
    }

    const signed = `${SITE}/image/${encodeURIComponent(src)}?table=block&id=${blockId}&cache=v2`;
    try {
        const res = await fetch(signed);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        await fs.writeFile(outPath, buf);
        console.log(`  ↳ image ${safeName} (${buf.length} bytes)`);
        return path.posix.join("..", "assets", "posts", ctx.slug, safeName);
    } catch (e) {
        console.warn(`  ! image fetch failed for ${blockId}: ${e.message}`);
        return src;
    }
}

async function fetchPostBlocks(pageId) {
    // Recursively fetch chunks until cursor.stack is empty.
    const blockMap = {};
    let stack = [];
    let chunkNumber = 0;
    while (true) {
        const data = await loadPageChunk(pageId, chunkNumber, stack);
        Object.assign(blockMap, data.recordMap?.block || {});
        const cursor = data.cursor;
        if (!cursor || !cursor.stack || cursor.stack.length === 0) break;
        stack = cursor.stack;
        chunkNumber += 1;
        if (chunkNumber > 10) break; // safety
    }
    return blockMap;
}

async function buildPost(pageId, propertiesFromCollection) {
    const blockMap = await fetchPostBlocks(pageId);
    const pageBlock = blockMap[pageId]?.value?.value;
    if (!pageBlock) throw new Error(`Page ${pageId} not loaded`);

    const props = { ...(pageBlock.properties || {}), ...(propertiesFromCollection || {}) };
    const title = plainText(props.title || []) || "Untitled";
    const published = notionDateText(props["Z]mk"]) || "";
    const tldr = plainText(props["_Z\\h"] || []);
    const slugFromProp = plainText(props["\\]EP"] || "");
    const slug = (slugFromProp ? slugify(slugFromProp) : slugify(title)) || pageId.slice(0, 8);

    const ctx = { slug };
    const childIds = pageBlock.content || [];
    const bodyLines = [];
    for (const id of childIds) {
        const lines = await blockToMd(id, blockMap, ctx, 0);
        bodyLines.push(...lines, "");
    }

    const fm = ["---"];
    fm.push(`title: ${JSON.stringify(title)}`);
    if (published) fm.push(`date: ${published}`);
    if (tldr) fm.push(`tldr: ${JSON.stringify(tldr)}`);
    fm.push(`notion_id: ${pageId}`);
    fm.push("---", "");

    const md = fm.join("\n") + "\n" + bodyLines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";

    return { slug, published, title, tldr, md };
}

async function main() {
    await ensureDir(POSTS_DIR);
    await ensureDir(ASSETS_DIR);

    console.log("Querying Posts collection…");
    const q = await queryCollection();
    const blocks = q.recordMap?.block || {};
    const collectionPostIds = q.result?.reducerResults?.collection_group_results?.blockIds || [];

    // Fall back to enumerating all collection-row pages in the recordMap if the
    // reducer didn't populate.
    const allPostIds = collectionPostIds.length
        ? collectionPostIds
        : Object.entries(blocks)
              .filter(([, b]) => b.value?.value?.parent_id === POSTS_COLLECTION_ID)
              .map(([id]) => id);

    console.log(`Found ${allPostIds.length} posts.`);

    const index = [];
    for (const pid of allPostIds) {
        const row = blocks[pid]?.value?.value;
        const props = row?.properties || {};
        const title = plainText(props.title || []) || pid;
        console.log(`\n• ${title} (${pid})`);
        try {
            const post = await buildPost(pid, props);
            const outName = (post.published ? `${post.published}-${post.slug}` : post.slug) + ".md";
            const outPath = path.join(POSTS_DIR, outName);
            await fs.writeFile(outPath, post.md, "utf8");
            console.log(`  → ${path.relative(ROOT, outPath)}`);
            index.push({ ...post, file: outName });
        } catch (e) {
            console.error(`  ! failed: ${e.message}`);
        }
    }

    // Sort newest first.
    index.sort((a, b) => (b.published || "").localeCompare(a.published || ""));
    await fs.writeFile(
        path.join(POSTS_DIR, "index.json"),
        JSON.stringify(index, null, 2),
        "utf8",
    );
    console.log(`\nWrote ${index.length} posts + posts/index.json`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
