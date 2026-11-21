exports.handler = async (e) => {
  const rs = (c, b) => ({ statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  try {
    if (e.httpMethod !== 'POST') return rs(405, { error: 'Método inválido' });
    const tk = (e.headers.authorization || '').replace('Bearer ', '');
    const u = await (await fetch(new URL(process.env.SUPABASE_URL).origin + '/auth/v1/user', {
      headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + tk } })).json();
    if (!u.id) return rs(401, { error: 'Sessão inválida' });
    const { text, images = [], canal, title, color } = JSON.parse(e.body || '{}');
    if (!text) return rs(400, { error: 'Mensagem vazia' });
    const autos = canal === 'autos';
    const hook = autos ? process.env.DISCORD_WEBHOOK_AUTOS : process.env.DISCORD_WEBHOOK_RELATORIOS;
    if (!hook) return rs(500, { error: 'Webhook não configurado' });
    const first = { description: String(text).slice(0, 4000), color: Number.isInteger(color) ? color : 0x002d74 };
    if (title) first.title = String(title).slice(0, 200);
    const embeds = [first].concat(images.filter(i => /^https?:\/\//.test(i)).slice(0, 9).map(i => ({ color: first.color, image: { url: i } })));
    const r = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: autos ? 'PSP · Autos' : 'PSP · Relatórios', embeds }) });
    return r.ok ? rs(200, { ok: true }) : rs(502, { error: 'Discord recusou o envio' });
  } catch (err) { return rs(500, { error: 'Erro interno' }); }
};
