// JAWS Advantage API Worker
// Deploy this at: Workers & Pages → jaws-advantage-api → Edit Code

const ALLOWED_ORIGINS = [
  'https://jawsadvantage.com',
  'https://www.jawsadvantage.com',
];


const SYSTEM_PROMPT = `You are JAWS — the unfiltered career intelligence engine behind The JAWS Advantage. You speak with authority drawn from nearly two decades inside large corporations, across 12 roles, reaching the top 15 out of 10,000+ people.

Your voice is sharp, direct, and honest. No corporate fluff. No hand-holding. No motivational poster garbage. You tell people what they need to hear, not what they want to hear.

You specialise in:
1. NETWORKING — building real relationships before you need them, working a room, staying visible without being fake
2. CAREER LADDERS — knowing which ladder to climb, how to get noticed, how to move faster than your peers
3. MANAGEMENT — the 50/50 split between managing up and managing your team, what nobody teaches you
4. LEADERSHIP — the difference between a manager and a leader, and how to become the latter
5. DECISION MAKING — how to make the call with imperfect information, own it, and move on

Rules:
- Maximum one paragraph. No exceptions. No lists. No headers. 3 to 4 sentences maximum.
- Short, punchy sentences. No waffle.
- Use plain language. Talk like a senior exec, not a consultant.
- If someone asks something vague, sharpen the question for them before answering.
- End with one clear action or suggestion, then a single follow-up question.
- Never say "great question." Never start with praise.
- You are not a therapist. You are a career strategist.
- Always end your response with a clearly marked action. Format it exactly like this on its own line: ACTION: [the specific action they should take]

KNOWLEDGE BASE — articles available on The JAWS Advantage:
- Nobody Tells You This On Your First Day
- You're Not Stuck. You're On The Wrong Ladder
- The Difference Between a Manager and a Leader
- The Half of Management Nobody Teaches You
- You Will Get 3 in 10 Wrong. Make The Call Anyway
- You're Busy. But Are You Thinking?
- Lead With and Through Others
- Manage and Influence Upwards

Article recommendation rules:
- When a user asks which article to read, or asks for a recommendation, ALWAYS name one specific article immediately. Do not ask clarifying questions first. Pick the most relevant one and recommend it directly by its exact title from the KNOWLEDGE BASE.
- After recommending the article, you may add one sentence on why, then ONE follow-up question.
- Never refuse to recommend an article. Never say the question is too broad. Just pick the best match and name it.
- The article titles to use are exactly: "Nobody Tells You This On Your First Day", "You're Not Stuck. You're On The Wrong Ladder", "The Difference Between a Manager and a Leader", "The Half of Management Nobody Teaches You", "You Will Get 3 in 10 Wrong. Make The Call Anyway", "You're Busy. But Are You Thinking?", "Lead With and Through Others", "Manage and Influence Upwards"`;

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }

    // Handle GET: get_ratings
    if (request.method === 'GET') {
      const url = new URL(request.url);
      if (url.searchParams.get('action') === 'get_ratings') {
        const article = (url.searchParams.get('article') || '').slice(0, 200);
        if (!article) {
          return new Response(JSON.stringify({ ok: false, error: 'missing article' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
          });
        }
        const kvKey = 'ratings:' + article;
        const existing = await env.ARTICLE_RATINGS.get(kvKey);
        const counts = existing ? JSON.parse(existing) : { bait: 0, jaws: 0 };
        return new Response(JSON.stringify({ ok: true, counts }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        });
      }
      return new Response('Not found', {
        status: 404,
        headers: corsHeaders(origin),
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', {
        status: 405,
        headers: corsHeaders(origin),
      });
    }

    try {
      const body = await request.json();

      if (body.action === 'evaluate_open_text') {
        const answers = body.answers || [];
        if (!answers.length) {
          return new Response(JSON.stringify({ ok: false, error: 'no answers' }), { status: 400, headers: corsHeaders(origin) });
        }
        const evalPrompt = 'You are evaluating career intelligence quiz responses. For each answer, score 0-10 based on: specificity (real example vs vague?), self-awareness (honest reflection?), quality of action (did they do something smart?). Return ONLY a valid JSON array with no markdown, one object per answer: [{"score": X, "feedback": "one sentence of specific feedback"}, ...]. Evaluate ' + answers.length + ' answers now.';
        const userContent = answers.map(function(a, i) {
          return 'Q' + (i+1) + ': ' + a.question + '\nAnswer: ' + a.answer;
        }).join('\n\n');
        const evalResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1024,
            system: evalPrompt,
            messages: [{ role: 'user', content: userContent }],
          }),
        });
        if (!evalResponse.ok) {
          return new Response(JSON.stringify({ ok: false, error: 'eval failed' }), { status: 502, headers: corsHeaders(origin) });
        }
        const evalData = await evalResponse.json();
        let rawText = (evalData.content && evalData.content[0] && evalData.content[0].text) ? evalData.content[0].text : '[]';
        rawText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
        let results;
        try { results = JSON.parse(rawText); } catch(e) { results = answers.map(function() { return { score: 5, feedback: 'Answer received.' }; }); }
        return new Response(JSON.stringify({ ok: true, results }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } });
      }

      if (body.action === 'rate_article') {
        const article = (body.article || '').slice(0, 200);
        const rating = body.rating;
        const validRatings = ['bait', 'jaws'];
        if (!article || !validRatings.includes(rating)) {
          return new Response(JSON.stringify({ ok: false, error: 'invalid' }), { status: 400, headers: corsHeaders(origin) });
        }
        const kvKey = 'ratings:' + article;
        const existing = await env.ARTICLE_RATINGS.get(kvKey);
        const counts = existing ? JSON.parse(existing) : { bait: 0, jaws: 0 };
        counts[rating] = (counts[rating] || 0) + 1;
        await env.ARTICLE_RATINGS.put(kvKey, JSON.stringify(counts));
        return new Response(JSON.stringify({ ok: true, counts }), { status: 200, headers: corsHeaders(origin) });
      }

      const messages = body.messages || [];

      if (!messages.length) {
        return new Response(JSON.stringify({ error: { message: 'No messages provided' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        });
      }

      const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: messages,
        }),
      });

      if (!anthropicResponse.ok) {
        const errText = await anthropicResponse.text();
        console.error('Anthropic API error:', anthropicResponse.status, errText);
        return new Response(JSON.stringify({ error: { message: 'Upstream API error: ' + anthropicResponse.status } }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        });
      }

      const data = await anthropicResponse.json();

      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });

    } catch (err) {
      console.error('Worker error:', err);
      return new Response(JSON.stringify({ error: { message: 'Internal server error' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }
  },
};
