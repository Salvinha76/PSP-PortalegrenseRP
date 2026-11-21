const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, '../psp-portal/index.html'), 'utf8');
const source = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1]).filter(Boolean).join('\n')
  .replace(/SB_KEY='[^']*'/, 'SB_KEY="unused"');

async function setup(options = {}) {
  const state = {session: null, attempts: [], signOuts: 0, entered: false};
  const nodes = Object.fromEntries(['#root', '#n', '#p', '#err', '#login-submit'].map(id =>
    [id, {value: '', innerHTML: '', textContent: '', disabled: false}]));
  const profile = {id: 'user-id', nivel: 'diretor', ativo: true,
    must_change_password: false, tutorial_done: true, ...options.profile};
  const sb = {
    auth: {
      getSession: async () => ({data: {session: state.session}, error: options.sessionError}),
      signInWithPassword: async input => {
        state.attempts.push(input);
        if (options.networkFailure) throw new TypeError('Network unavailable');
        if (options.authError) return {error: options.authError};
        state.session = {user: {id: profile.id}};
        return {error: null};
      },
      signOut: async () => {state.signOuts++; state.session = null; return {error: null};},
    },
    from: table => {
      assert.equal(table, 'profiles');
      return {select: () => ({eq: (field, id) => {
        assert.equal(field, 'id');
        assert.equal(id, state.session.user.id);
        return {single: async () => ({data: options.profileError ? null : profile,
          error: options.profileError})};
      }})};
    },
  };
  const context = vm.createContext({URL, document: {
    querySelector: selector => nodes[selector], addEventListener() {},
  }, supabase: {createClient: url => {state.clientUrl = url; return sb;}}});
  vm.runInContext(source, context);
  vm.runInContext('go=()=>{globalThis.entered=true}', context);
  await new Promise(setImmediate);
  const submit = async (identifier = '2026002') => {
    nodes['#n'].value = identifier;
    nodes['#p'].value = '  test input  ';
    let prevented = false;
    const result = context.doLogin({preventDefault() {prevented = true;}});
    assert.equal(prevented, true);
    await result;
  };
  return {state, nodes, context, submit};
}

test('the SDK receives the project root, without the database REST path', async () => {
  const {state} = await setup();
  const configured = new URL(html.match(/SB_URL='([^']+)'/)[1]);
  assert.equal(state.clientUrl, configured.origin);
});

test('a director signs in with a trimmed officer number and sees Direção', async () => {
  const {state, nodes, context, submit} = await setup();
  await submit('  2026002  ');
  assert.equal(state.attempts[0].email, '2026002@psp.rp');
  assert.equal(state.attempts[0].password, nodes['#p'].value);
  assert.equal(context.entered, true);
  assert.match(nodes['#root'].innerHTML, /nav-direcao/);
});

test('a full admin email is normalized without adding another domain', async () => {
  const {state, submit} = await setup();
  await submit('  ADMIN@EXAMPLE.ORG  ');
  assert.equal(state.attempts[0].email, 'admin@example.org');
});

test('invalid credentials keep the login form available with a clear error', async () => {
  const {nodes, context, submit} = await setup({authError: {status: 400}});
  await submit();
  assert.match(nodes['#err'].textContent, /incorretos/);
  assert.equal(nodes['#login-submit'].disabled, false);
  assert.equal(context.entered, undefined);
});

test('a network failure shows a connection error and permits retrying', async () => {
  const {nodes, submit} = await setup({networkFailure: true});
  await submit();
  assert.match(nodes['#err'].textContent, /ligar ao serviço/);
  assert.equal(nodes['#login-submit'].disabled, false);
  assert.equal(nodes['#login-submit'].textContent, 'Entrar');
});

test('rate limiting is distinguished from an incorrect password', async () => {
  const {nodes, submit} = await setup({authError: {status: 429}});
  await submit();
  assert.match(nodes['#err'].textContent, /Demasiadas tentativas/);
});

test('profile loading failures are reported without claiming the account is inactive', async () => {
  const {state, nodes, context, submit} = await setup({profileError: {code: 'unavailable'}});
  await submit();
  assert.match(nodes['#err'].textContent, /carregar o perfil/);
  assert.equal(state.signOuts, 0);
  assert.equal(context.entered, undefined);
});

test('an inactive director is signed out and cannot enter the dashboard', async () => {
  const {state, nodes, context, submit} = await setup({profile: {ativo: false}});
  await submit();
  assert.equal(state.signOuts, 1);
  assert.equal(context.entered, undefined);
  assert.doesNotMatch(nodes['#root'].innerHTML, /nav-direcao/);
  assert.match(nodes['#err'].textContent, /Conta inativa/);
});

test('agents still do not receive the director navigation', async () => {
  const {nodes, context, submit} = await setup({profile: {nivel: 'agente'}});
  await submit();
  assert.equal(context.entered, true);
  assert.doesNotMatch(nodes['#root'].innerHTML, /nav-direcao/);
});

test('session restoration failures show a login form instead of a blank screen', async () => {
  const {nodes} = await setup({sessionError: new Error('Unavailable')});
  assert.match(nodes['#root'].innerHTML, /login-submit/);
  assert.match(nodes['#err'].textContent, /iniciar a sessão/);
});
