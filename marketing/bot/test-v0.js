// Frame Twitter Bot — Test v0
// Purpose: measure real tweet volume + validate API access.
// Run manually once a day for 3 days, then decide on full bot scope.

import 'dotenv/config';
import fs from 'fs/promises';

const BEARER = process.env.X_BEARER_TOKEN;
if (!BEARER) {
  console.error('Missing X_BEARER_TOKEN in .env');
  process.exit(1);
}

const KEYWORDS = [
  '"claude code"',
  '"CLAUDE.md"',
  '"agentic coding"',
];

const MAX_RESULTS = 100;
const COST_PER_READ = 0.005;

async function searchRecent(query) {
  const params = new URLSearchParams({
    query,
    max_results: String(MAX_RESULTS),
    'tweet.fields': 'created_at,public_metrics,author_id,lang',
    'expansions': 'author_id',
    'user.fields': 'username,public_metrics,description',
  });

  const url = `https://api.x.com/2/tweets/search/recent?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${BEARER}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }

  return res.json();
}

function bucketByFollowers(users) {
  const buckets = { mega: 0, large: 0, mid: 0, small: 0, micro: 0 };
  for (const u of users) {
    const f = u.public_metrics?.followers_count ?? 0;
    if (f >= 100_000) buckets.mega++;
    else if (f >= 20_000) buckets.large++;
    else if (f >= 1_000) buckets.mid++;
    else if (f >= 100) buckets.small++;
    else buckets.micro++;
  }
  return buckets;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const startedAt = new Date().toISOString();
  const results = {};
  let totalTweets = 0;
  const allUsers = [];

  for (const kw of KEYWORDS) {
    process.stdout.write(`Searching ${kw}... `);
    try {
      const data = await searchRecent(kw);
      const tweets = data.data || [];
      const users = data.includes?.users || [];
      const userMap = users.reduce((m, u) => (m[u.id] = u, m), {});

      results[kw] = {
        count: tweets.length,
        nextToken: data.meta?.next_token ?? null,
        followerBuckets: bucketByFollowers(users),
        sample: tweets.slice(0, 10).map((t) => {
          const u = userMap[t.author_id];
          return {
            tweetId: t.id,
            author: u?.username,
            followers: u?.public_metrics?.followers_count,
            bio: u?.description?.slice(0, 120),
            text: t.text.slice(0, 240),
            metrics: t.public_metrics,
            created_at: t.created_at,
            lang: t.lang,
            url: u ? `https://x.com/${u.username}/status/${t.id}` : null,
          };
        }),
      };
      totalTweets += tweets.length;
      allUsers.push(...users);
      console.log(`${tweets.length} tweets`);
    } catch (e) {
      console.log(`ERROR`);
      console.error(`  → ${e.message}`);
      results[kw] = { error: e.message };
    }
  }

  const summary = {
    date: today,
    startedAt,
    keywords: KEYWORDS,
    totalTweets,
    estimatedCost: Number((totalTweets * COST_PER_READ).toFixed(3)),
    overallFollowerBuckets: bucketByFollowers(allUsers),
    results,
  };

  await fs.mkdir('./data', { recursive: true });
  await fs.writeFile(
    `./data/results-${today}.json`,
    JSON.stringify(summary, null, 2),
  );

  console.log(`\n=== Run Summary (${today}) ===`);
  console.log(`Total tweets read:  ${totalTweets}`);
  console.log(`Estimated cost:     $${summary.estimatedCost.toFixed(3)}`);
  console.log(`Author follower mix:`, summary.overallFollowerBuckets);
  console.log(`Saved to:           data/results-${today}.json`);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
