const U = process.env.SUPABASE_URL, S = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: S, Authorization: 'Bearer ' + S, 'Content-Type': 'application/json' };
const rs = (c, b) => ({ statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const rest = (p, o = {}) => fetch(U + p, { headers: H, ...o });

exports.handler = async (e) => {
  try {
    if (e.httpMethod !== 'POST') return rs(405, { error: 'Método inválido' });
    const tk = (e.headers.authorization || '').replace('Bearer ', '');
    const u = await (await fetch(U + '/auth/v1/user', { headers: { apikey: S, Authorization: 'Bearer ' + tk } })).json();
    if (!u.id) return rs(401, { error: 'Sessão inválida' });
    const me = (await (await rest(`/rest/v1/profiles?id=eq.${u.id}&select=nivel,ativo`)).json())[0];
    if (!me || me.nivel !== 'diretor' || !me.ativo) return rs(403, { error: 'Sem permissão' });

    const b = JSON.parse(e.body || '{}');
    const pw = 'PSP-' + require('crypto').randomBytes(4).toString('hex') + '!';

    if (b.action === 'reset') {
      const r = await rest('/auth/v1/admin/users/' + b.id, { method: 'PUT', body: JSON.stringify({ password: pw }) });
      if (!r.ok) return rs(400, { error: 'Falha ao repor a palavra-passe' });
      await rest('/rest/v1/profiles?id=eq.' + b.id, { method: 'PATCH', body: JSON.stringify({ must_change_password: true, tutorial_done: false }) });
      return rs(200, { password: pw });
    }

    if (!b.nome || !b.patente) return rs(400, { error: 'Falta o nome ou a patente' });
    const last = (await (await rest('/rest/v1/profiles?select=numero&order=numero.desc&limit=1')).json())[0];
    const numero = last ? String(Number(last.numero) + 1) : '2026001';
    const cu = await rest('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: numero + '@psp.rp', password: pw, email_confirm: true }) });
    const au = await cu.json();
    if (!au.id) return rs(400, { error: 'Falha ao criar o utilizador' });
    const pr = await rest('/rest/v1/profiles', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({ id: au.id, numero, nome: b.nome, patente: b.patente, direcao: b.direcao, nivel: b.nivel === 'diretor' ? 'diretor' : 'agente' }) });
    if (!pr.ok) { await rest('/auth/v1/admin/users/' + au.id, { method: 'DELETE' }); return rs(400, { error: 'Falha ao criar o perfil' }); }
    await rest('/rest/v1/efetivos', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({ numero, nome: b.nome, patente: b.patente, direcao: b.direcao }) });
    return rs(200, { numero, password: pw });
  } catch (err) { return rs(500, { error: 'Erro interno' }); }
};
