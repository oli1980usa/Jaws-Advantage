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
- Only include an ACTION THIS WEEK block when the user has described a specific situation, challenge, or behavioural question where a concrete next step genuinely adds value. Do NOT include ACTION THIS WEEK when the user is asking for a reading recommendation, asking what something means, asking a factual question, or when the response is primarily directing them to an article or resource. The action must be distinct from the response itself — do not simply repeat "read the article" as an action. When you do include one, format it exactly like this on its own line: ACTION THIS WEEK: [the specific action they should take]

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

      if (body.action === 'get_quiz_votes') {
        const quizId = body.quizId || '';
        if (!quizId) return new Response(JSON.stringify({ up: 0, down: 0 }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } });
        const upKey = 'quiz-' + quizId + '-up';
        const downKey = 'quiz-' + quizId + '-down';
        const [upVal, downVal] = await Promise.all([
          env.ARTICLE_RATINGS.get(upKey),
          env.ARTICLE_RATINGS.get(downKey)
        ]);
        return new Response(JSON.stringify({
          up: parseInt(upVal || '0'),
          down: parseInt(downVal || '0')
        }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } });
      }

      if (body.action === 'vote_quiz') {
        const quizId = body.quizId || '';
        const direction = body.direction || '';
        if (!quizId || !['up','down'].includes(direction)) {
          return new Response(JSON.stringify({ ok: false }), { status: 400, headers: corsHeaders(origin) });
        }
        const upKey = 'quiz-' + quizId + '-up';
        const downKey = 'quiz-' + quizId + '-down';
        const [upVal, downVal] = await Promise.all([
          env.ARTICLE_RATINGS.get(upKey),
          env.ARTICLE_RATINGS.get(downKey)
        ]);
        var upCount = parseInt(upVal || '0');
        var downCount = parseInt(downVal || '0');
        if (direction === 'up') upCount++;
        else downCount++;
        await Promise.all([
          env.ARTICLE_RATINGS.put(upKey, String(upCount)),
          env.ARTICLE_RATINGS.put(downKey, String(downCount))
        ]);
        return new Response(JSON.stringify({ up: upCount, down: downCount }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
        });
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

      if (body.action === 'job_posting_analyse') {
        const text = body.text || '';
        const mode = body.mode || 'jaws';
        if (!text || text.length < 50) {
          return new Response(JSON.stringify({ error: 'No text provided' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } });
        }

        const jawsPrompt = `You are JAWS — the unfiltered career intelligence engine. A user has pasted a job posting. Analyse it ruthlessly. Cut through the corporate language, identify the red flags, decode what they really want, reality-check the requirements, and give an honest verdict on whether this role is worth pursuing.

Return ONLY valid JSON with no markdown in this exact format:
{
  "redFlags": ["specific red flag 1", "specific red flag 2", "specific red flag 3"],
  "whatTheyWant": "A paragraph explaining what skills and experience they actually need vs what they've listed. Be specific about what matters.",
  "requirementsCheck": "A paragraph being honest about the requirements. Which ones are real dealbreakers? Which are aspirational padding? What would they probably accept from a strong candidate who doesn't tick every box? Be direct — if they're asking for 10 years experience for a role that doesn't need it, say so.",
  "hiddenSubtext": "A paragraph on what this role really is. Is it a replacement for someone who just left? A stretched team desperate for help? A role with no budget for the right person? Read between the lines.",
  "verdict": "One sharp paragraph. Is this worth applying for? Who should apply and who should run? What's the one thing the applicant needs to nail to get this role? Be direct."
}

Rules:
- Red flags should be specific to THIS posting, not generic advice
- Requirements reality check is the most important section — be genuinely useful about what they'd probably accept
- Never be vague
- If the posting is genuinely good and honest, say so
- NEVER name specific companies, employers, or individuals by name — refer to them generically as "this company" or "the employer"
- NEVER make specific factual claims that could be verified or disproved — stick to observations, opinions, and interpretations
- NEVER state that a company is doing anything illegal, fraudulent, or criminal
- All output is satirical opinion and commentary — frame observations as "this reads like..." or "this sounds like..." or "this suggests..." rather than stating facts
- If a company name appears in the pasted text, do not repeat it in your response`;

        const chumPrompt = `You are a shark who has spent 20 years hiring people and has seen every corporate trick in the book. A user has pasted a job posting. Tear it apart — savagely, vulgarly, and hilariously. Use shark and ocean metaphors. Swear freely. Be savage but be RIGHT.

Keep it SHORT and PUNCHY. Each section should be 2-4 sentences maximum. The humour comes from being brutally accurate, not from being long-winded. Hit hard and move on.

Return ONLY valid JSON with no markdown in this exact format:
{
  "redFlags": ["one punchy savage red flag", "another one", "another one — max 4 total"],
  "whatTheyWant": "2-3 sentences MAX. What they actually want vs this fantasy. Sweary, shark-themed, brutal.",
  "requirementsCheck": "2-3 sentences MAX. Call out the most ridiculous requirements. What would they actually accept? Be vulgar and funny but accurate.",
  "hiddenSubtext": "2-3 sentences MAX. What is this role really? Read between the lines. Savage and specific.",
  "verdict": "3-4 sentences MAX. Should they apply or swim away? Punchy. Funny. Accurate. Use shark language."
}

Rules:
- SHORT. Every section must be 2-4 sentences or bullet points. No essays.
- Sweary and shark-themed throughout
- Specific to THIS posting not generic
- Funny because you're RIGHT, not just crude
- If the posting is actually decent, say so in one savage sentence
- NEVER name specific companies, employers, or individuals by name — refer to them generically as "this company" or "the employer"
- NEVER make specific factual claims that could be verified or disproved — stick to observations, opinions, and interpretations
- NEVER state that a company is doing anything illegal, fraudulent, or criminal
- All output is satirical opinion and commentary — frame observations as "this reads like..." or "this sounds like..." or "this suggests..." rather than stating facts
- If a company name appears in the pasted text, do not repeat it in your response`;

        const analysePrompt = mode === 'chum' ? chumPrompt : jawsPrompt;

        const analyseResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1500,
            system: analysePrompt,
            messages: [{ role: 'user', content: 'Analyse this job posting:\n\n' + text }],
          }),
        });

        if (!analyseResponse.ok) {
          return new Response(JSON.stringify({ error: 'analysis failed' }), { status: 502, headers: corsHeaders(origin) });
        }

        const analyseData = await analyseResponse.json();
        let rawText = (analyseData.content && analyseData.content[0] && analyseData.content[0].text) ? analyseData.content[0].text : '{}';
        rawText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
        let result;
        try {
          result = JSON.parse(rawText);
        } catch(e) {
          result = { redFlags: ['Could not analyse this posting. Try pasting a different section.'], whatTheyWant: '', requirementsCheck: '', hiddenSubtext: '', verdict: '' };
        }
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
        });
      }

      if (body.action === 'jaws_decode') {
        const text = body.text || '';
        if (!text || text.length < 10) {
          return new Response(JSON.stringify({ error: 'No text provided' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } });
        }

        const mode = body.mode || 'jaws';

        const jawsPrompt = `You are JAWS — the unfiltered career intelligence engine. A user has pasted a piece of corporate communication. Your job is to decode it — cut through the spin, the jargon, and the corporate language and tell them what it actually means.

Return ONLY valid JSON with no markdown, in this exact format:
{
  "translations": [
    {"phrase": "the exact corporate phrase", "meaning": "what it actually means in plain English"},
    {"phrase": "another phrase", "meaning": "what it actually means"}
  ],
  "verdict": "One sharp paragraph. What does this communication actually mean overall? What is the person really saying or doing? What should the reader do about it? Be direct. Be specific. Use the JAWS voice — authoritative, unfiltered, no fluff."
}

Rules:
- Pick the 3-6 most significant corporate phrases, jargon, or euphemisms from the text
- Translations should be sharp, specific, and sometimes darkly funny — but always accurate
- The verdict should be the most useful thing — what does this mean for the person reading it and what should they do?
- Never be vague. Never hedge. Never use corporate language yourself.
- If the text is genuinely clear and honest, say so — not everything is spin
- NEVER name specific companies, employers, or individuals by name — refer to them generically as "this company" or "the employer"
- NEVER make specific factual claims that could be verified or disproved — stick to observations, opinions, and interpretations
- NEVER state that a company is doing anything illegal, fraudulent, or criminal
- All output is satirical opinion and commentary — frame observations as "this reads like..." or "this sounds like..." or "this suggests..." rather than stating facts
- If a company name appears in the pasted text, do not repeat it in your response`;

        const chumPrompt = `You are a shark who has been trapped in corporate meetings for 20 years and has completely lost it. A user has pasted some corporate communication. Decode it — brutally, vulgarly, and hilariously. Use shark and ocean metaphors throughout. Be sweary. Be savage. Be funny. Call out the bullshit with zero filter.

Return ONLY valid JSON with no markdown, in this exact format:
{
  "translations": [
    {"phrase": "the exact corporate phrase", "meaning": "what it actually means — be vulgar, sweary, and use shark metaphors"},
    {"phrase": "another phrase", "meaning": "savage translation"}
  ],
  "verdict": "One unhinged paragraph. What does this actually mean? What are these bottom-feeders really saying? Use shark language — chum, bait, feeding frenzy, apex predator, dead in the water. Be funny. Be sweary. Be brutally honest about what the reader should do. Channel the energy of someone who has had enough of this shit and is not holding back."
}

Rules:
- Pick the 3-6 most ridiculous corporate phrases from the text
- Translations should be vulgar, sweary, and use shark/ocean metaphors — chum, bait, feeding frenzy, remora, dead in the water, shark cage, apex predator
- The verdict should make the reader laugh AND tell them exactly what to do
- Swear freely — this is CHUM MODE, the gloves are off
- If someone is clearly being played or managed out, say so in the most colourful terms possible
- Example translation style: "ongoing market conditions" → "these absolute clowns have no idea what's happening with the money and they're hoping you won't notice"
- Example verdict style: "This is weapons-grade corporate horseshit. You're being managed out/ignored/played and they've wrapped it in enough jargon to make it sound almost reasonable. Don't fall for it. Here's what you actually do..."
- NEVER name specific companies, employers, or individuals by name — refer to them generically as "this company" or "the employer"
- NEVER make specific factual claims that could be verified or disproved — stick to observations, opinions, and interpretations
- NEVER state that a company is doing anything illegal, fraudulent, or criminal
- All output is satirical opinion and commentary — frame observations as "this reads like..." or "this sounds like..." or "this suggests..." rather than stating facts
- If a company name appears in the pasted text, do not repeat it in your response`;

        const decodePrompt = mode === 'chum' ? chumPrompt : jawsPrompt;

        const decodeResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1024,
            system: decodePrompt,
            messages: [{ role: 'user', content: 'Decode this corporate communication:\n\n' + text }],
          }),
        });

        if (!decodeResponse.ok) {
          return new Response(JSON.stringify({ error: 'decode failed' }), { status: 502, headers: corsHeaders(origin) });
        }

        const decodeData = await decodeResponse.json();
        let rawText = (decodeData.content && decodeData.content[0] && decodeData.content[0].text) ? decodeData.content[0].text : '{}';
        rawText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
        let result;
        try {
          result = JSON.parse(rawText);
        } catch(e) {
          result = { translations: [], verdict: 'JAWS could not decode this one. Try pasting a different section.' };
        }
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
        });
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
