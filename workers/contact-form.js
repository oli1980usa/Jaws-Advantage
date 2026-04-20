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
      const { name, email, topic, message, _gotcha } = data;

      if (_gotcha) {
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (!name || !email || !message) {
        return new Response(JSON.stringify({ success: false, error: 'Missing required fields' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      await env.CONTACT_EMAIL.send({
        from: 'contact@jawsadvantage.com',
        to: 'info@jawsadvantage.com',
        subject: `Contact Form: ${topic || 'General Enquiry'} — from ${name}`,
        content: `Name: ${name}\nEmail: ${email}\nTopic: ${topic || 'Not specified'}\n\nMessage:\n${message}`,
        replyTo: email,
      });

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
