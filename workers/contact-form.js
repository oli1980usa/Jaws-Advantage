export default {
  async fetch(request, env) {

    const corsHeaders = {
      'Access-Control-Allow-Origin': 'https://jawsadvantage.com',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const data = await request.json();
      const { name, email, topic, message, _gotcha, turnstileToken } = data;

      if (_gotcha) {
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const ip = request.headers.get('CF-Connecting-IP');
      const turnstileVerification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: env.TURNSTILE_SECRET_KEY,
          response: turnstileToken,
          remoteip: ip,
        }),
      });

      const turnstileResult = await turnstileVerification.json();

      if (!turnstileResult.success) {
        return new Response(JSON.stringify({ success: false, error: 'Security check failed. Please try again.' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (!name || !email || !message) {
        return new Response(JSON.stringify({ success: false, error: 'Missing required fields' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'JAWS Advantage <onboarding@resend.dev>',
          to: ['info@jawsadvantage.com'],
          reply_to: email,
          subject: `Contact Form: ${topic || 'General Enquiry'} — from ${name}`,
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
              <h2 style="color:#a52a1a;">New Contact Form Submission</h2>
              <p><strong>Name:</strong> ${name}</p>
              <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
              <p><strong>Topic:</strong> ${topic || 'Not specified'}</p>
              <h3 style="color:#a52a1a;">Message:</h3>
              <div style="background:#f5f3ef;padding:16px;border-left:4px solid #a52a1a;">
                <p style="white-space:pre-wrap;margin:0;">${message}</p>
              </div>
            </div>
          `,
        }),
      });

      if (!resendResponse.ok) {
        const err = await resendResponse.json();
        console.error('Resend error:', err);
        return new Response(JSON.stringify({ success: false, error: 'Failed to send email' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (err) {
      console.error('Worker error:', err);
      return new Response(JSON.stringify({ success: false, error: 'Server error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};
