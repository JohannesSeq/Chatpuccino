// Estado local del formulario de configuración y cálculo del parche mínimo que se envía al guardar.

const clone = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function formFromConfig(config) {
  return {
    connection: { baseUrl: config.connection.baseUrl, user: config.connection.user, pass: '', clearPass: false },
    model: { checkpoint: config.model.checkpoint, vae: config.model.vae, clipSkip: config.model.clipSkip },
    profiles: clone(config.profiles),
    expressionPrompts: { ...config.expressionPrompts },
  };
}

/** Parte de `form` que difiere de `config` (solo claves de primer nivel de cada perfil; hires/inpaint viajan completos). */
export function buildPatch(form, config) {
  const patch = {};

  const c = {};
  if (form.connection.baseUrl !== config.connection.baseUrl) c.baseUrl = form.connection.baseUrl;
  if (form.connection.user !== config.connection.user) c.user = form.connection.user;
  if (form.connection.clearPass) c.pass = '__clear__';
  else if (form.connection.pass) c.pass = form.connection.pass;
  if (Object.keys(c).length) patch.connection = c;

  const m = {};
  for (const key of ['checkpoint', 'vae', 'clipSkip']) if (form.model[key] !== config.model[key]) m[key] = form.model[key];
  if (Object.keys(m).length) patch.model = m;

  const profiles = {};
  for (const kind of Object.keys(form.profiles)) {
    const diff = {};
    for (const key of Object.keys(form.profiles[kind])) {
      if (!same(form.profiles[kind][key], config.profiles[kind][key])) diff[key] = form.profiles[kind][key];
    }
    if (Object.keys(diff).length) profiles[kind] = diff;
  }
  if (Object.keys(profiles).length) patch.profiles = profiles;

  const defaults = config.defaults.expressionPrompts;
  const prompts = {};
  for (const [label, value] of Object.entries(form.expressionPrompts)) {
    if (value === config.expressionPrompts[label]) continue;
    prompts[label] = value.trim() === (defaults[label] || '') ? '' : value;
  }
  for (const label of Object.keys(config.expressionPrompts)) {
    if (!(label in form.expressionPrompts)) prompts[label] = '';
  }
  if (Object.keys(prompts).length) patch.expressionPrompts = prompts;

  return patch;
}

export { clone };
