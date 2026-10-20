# Proteção anti-bot (camada 1): plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** impedir que bots (ou alguém trocando de número) ocupem a agenda inteira, sem cadastro em serviço externo e sem custo.

**Arquitetura:** quatro barreiras independentes no fluxo de reserva que já existe. As três primeiras ficam dentro de `criarReserva_` no Apps Script: campo-armadilha, tempo mínimo de preenchimento e teto de reservas pendentes com alerta. A quarta é uma rotina de hora em hora (gatilho do Apps Script) que cancela sinais não pagos depois do prazo. A página só passa a enviar dois campos novos e a mostrar o prazo do Pix.

**Tecnologia:** Google Apps Script (V8), HTML/CSS/JS sem framework, testes em Node com planilha simulada (`node tests/test.js`).

**Especificação:** a conversa de 2026-10-20 ("Camada 1: pouco trabalho"), aprovada pelo usuário com os valores sugeridos: teto de **6** pendentes e prazo de **12 horas**.

## Restrições globais

- Valores (em `CONFIG` no `Code.gs`): `TEMPO_MINIMO_MS: 3000`, `MAX_PENDENTES: 6`, `HORAS_EXPIRAR_SINAL: 12`.
- O Apps Script não recebe o IP de quem envia; nenhuma tarefa depende de IP.
- Cliente **recorrente** (tem ao menos 1 reserva `confirmada`) nunca é barrado pelo teto.
- Reserva expirada vira `cancelada`, porque a validação da coluna Status só aceita `confirmada`, `aguardando sinal` e `cancelada`.
- Mensagens ao cliente em português, sem "por favor", sem ponto de exclamação, dizendo o que fazer.
- Push para o GitHub **uma vez só, no fim** (cada push gera uma publicação no Netlify e gasta cerca de 15 créditos).
- Ordem de publicação: **site primeiro, script depois**. O site novo envia campos a mais, que o script antigo ignora; o contrário recusaria todas as reservas.

## Foco de revisão

Situações que a especificação implica, mas que um teste comum não pegaria. Cada uma tem um teste na tarefa dona do código.

1. **Cliente rápido de verdade.** Quem abre a página, escolhe o horário e usa o preenchimento automático do navegador pode enviar rápido. O tempo é contado desde que a página carregou, então 3 s é folgado. O limite exato (3000 ms passa, 2999 ms não) é testado na Tarefa 1.
2. **Preenchimento automático no campo-armadilha.** Se o navegador preencher o campo invisível, um cliente real seria recusado. O campo usa nome neutro (`campo_extra`), `autocomplete="off"` e fica fora da tela; o teste da Tarefa 1 garante que só texto real recusa (espaços em branco passam).
3. **Cliente recorrente com o teto atingido.** Precisa conseguir marcar normalmente (Tarefa 2).
4. **Enxurrada de alertas.** Um bot batendo no teto 100 vezes não pode gerar 100 e-mails. No máximo um alerta por hora (Tarefa 2).
5. **Linhas que a expiração não pode tocar:** `confirmada` antiga, `aguardando sinal` com menos de 12 h e linhas de bloqueio manual ou sem "Criado em". Só `aguardando sinal` com mais de 12 h vira `cancelada`, e a janela volta para o site (Tarefa 3).

---

## Mapa de arquivos

| Arquivo | O que muda |
|---|---|
| `apps-script/Code.gs` | 3 valores no `CONFIG`; funções puras `motivoAntiBot`, `contarPendentes` e `reservasParaExpirar`; `alertarTeto_`, `expirarSinais` e `instalarGatilhos`; checagens em `criarReserva_`; `prazoHoras` na resposta do Pix |
| `tests/test.js` | simulação ganha `getRange().setValue()` e `CacheService`; envio padrão ganha `tempoMs`; testes novos |
| `web/index.html` | campo-armadilha no formulário; `id` no texto do prazo do Pix |
| `web/reservas.css` | esconde o campo-armadilha |
| `web/reservas.js` | envia `tempoMs` e `campo_extra`; mostra o prazo do Pix; modo demo devolve `prazoHoras` |
| `docs/CONFIGURACAO.md` | seção "Proteção contra bots" e passo do gatilho |

---

### Tarefa 1: barrar bots simples (campo-armadilha e tempo mínimo)

**Arquivos:**
- Modificar: `apps-script/Code.gs` (bloco `CONFIG`, início de `criarReserva_`, seção de funções puras)
- Modificar: `tests/test.js` (helper `post`, testes novos no fim)

**Interfaces:**
- Produz: `motivoAntiBot(body, tempoMinimoMs) → '' | 'armadilha' | 'rapido'` (função pura); `CONFIG.TEMPO_MINIMO_MS`.
- Produz (contrato com a página, usado na Tarefa 4): o corpo do POST passa a ter `tempoMs` (número, ms desde que a página carregou) e `campo_extra` (texto, deve vir vazio).

- [ ] **Passo 1: ajustar o helper de envio dos testes**

Em `tests/test.js`, troque:

```js
const DADOS_CLIENTE = { nome: 'Maria Silva', endereco: 'Rua das Flores, 123, Centro' };
```

por:

```js
// tempoMs simula a pessoa levando 5 s entre abrir a página e enviar.
const DADOS_CLIENTE = { nome: 'Maria Silva', endereco: 'Rua das Flores, 123, Centro', tempoMs: 5000, campo_extra: '' };
```

- [ ] **Passo 2: escrever os testes que falham**

No fim de `tests/test.js`, antes de `console.log(\`\n${total} testes passaram.\`);`:

```js
const abasSimples = () => ({
  Horarios: [['Dia', 'Horário', 'Ativo'], ['terça', '08:00-11:00', 'sim']],
  Reservas: [['Data', 'Horário', 'Telefone', 'Status', 'Criado em', 'Nome', 'Endereço']],
});
const BASE = { data: '2026-10-20', horario: '08:00-11:00', telefone: '18999990000' };

teste('anti-bot: campo-armadilha preenchido é recusado sem gravar nem avisar', () => {
  const abas = abasSimples();
  const g = criarAmbiente('2026-10-19', abas);
  const r = post(g, { ...BASE, campo_extra: 'http://spam.example' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(abas.Reservas.length, 1, 'nada gravado');
  assert.strictEqual(g.emails.length, 0, 'nenhum aviso');
  assert.strictEqual(post(g, { ...BASE, campo_extra: '   ' }).ok, true, 'só espaços não conta como preenchido');
});

teste('anti-bot: envio rápido demais ou sem tempo é recusado; 3000 ms passa', () => {
  const g = criarAmbiente('2026-10-19', abasSimples());
  assert.strictEqual(g.motivoAntiBot({ tempoMs: 2999 }, 3000), 'rapido');
  assert.strictEqual(g.motivoAntiBot({}, 3000), 'rapido', 'sem tempoMs (chamada direta à API)');
  assert.strictEqual(g.motivoAntiBot({ tempoMs: 'abc' }, 3000), 'rapido');
  assert.strictEqual(g.motivoAntiBot({ tempoMs: 3000 }, 3000), '');
  assert.strictEqual(post(g, { ...BASE, tempoMs: 800 }).ok, false);
  assert.strictEqual(post(g, { ...BASE, tempoMs: 3000 }).ok, true);
});
```

- [ ] **Passo 3: rodar e ver falhar**

Run: `node tests/test.js`
Expected: FAIL em "anti-bot: campo-armadilha…" (`r.ok` vem `true`, porque ainda não há filtro).

- [ ] **Passo 4: implementar**

Em `apps-script/Code.gs`, no `CONFIG`, depois de `EMAIL_AVISO`:

```js
  TEMPO_MINIMO_MS: 3000,      // envio mais rápido que isso desde que a página abriu = bot
```

Na seção `/* ============== Funções puras (testadas em tests/test.js) ============== */`, logo abaixo do título:

```js
/** '' se parece gente; 'armadilha' se o campo invisível veio preenchido; 'rapido' se foi rápido demais. */
function motivoAntiBot(body, tempoMinimoMs) {
  if (String(body.campo_extra == null ? '' : body.campo_extra).trim()) return 'armadilha';
  const tempo = Number(body.tempoMs);
  if (!isFinite(tempo) || tempo < tempoMinimoMs) return 'rapido';
  return '';
}
```

No início de `criarReserva_(body)`, antes de `const telefone = …`:

```js
  const motivoBot = motivoAntiBot(body, CONFIG.TEMPO_MINIMO_MS);
  if (motivoBot) {
    console.warn('Reserva recusada pelo filtro anti-bot: ' + motivoBot);
    return { ok: false, erro: 'Não foi possível concluir a reserva. Recarregue a página e tente de novo.' };
  }
```

- [ ] **Passo 5: rodar e ver passar**

Run: `node tests/test.js`
Expected: `12 testes passaram.`

- [ ] **Passo 6: commit**

```bash
git add apps-script/Code.gs tests/test.js
git commit -m "Recusa reservas de bots: campo-armadilha e tempo mínimo de preenchimento"
```

---

### Tarefa 2: teto de reservas pendentes com alerta

**Arquivos:**
- Modificar: `apps-script/Code.gs` (`CONFIG`, `criarReserva_`, seção Avisos, funções puras)
- Modificar: `tests/test.js` (simulação do `CacheService`, testes novos)

**Interfaces:**
- Consome: `lerReservas_()` → `[{ data, horario, telefone, status }]` (já existe); `notificarEmail_(assunto, texto)` (já existe).
- Produz: `contarPendentes(reservas) → número` (pura); `alertarTeto_(pendentes)`; `CONFIG.MAX_PENDENTES`.

- [ ] **Passo 1: simular o CacheService nos testes**

Em `tests/test.js`, dentro de `criarAmbiente`, logo após `const emails = [];`:

```js
  const cache = {};
```

E no objeto `ctx`, depois da linha `MailApp: …`:

```js
    CacheService: {
      getScriptCache: () => ({ get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; } }),
    },
```

- [ ] **Passo 2: escrever os testes que falham**

No fim de `tests/test.js`, antes do `console.log` final:

```js
const comPendentes = (n) => {
  const abas = {
    Horarios: [['Dia', 'Horário', 'Ativo'], ['terça', '08:00-11:00', 'sim'], ['quarta', '08:00-11:00', 'sim']],
    Reservas: [['Data', 'Horário', 'Telefone', 'Status', 'Criado em', 'Nome', 'Endereço']],
  };
  // n pendentes em datas passadas, para não ocupar as janelas testadas
  for (let i = 0; i < n; i++) abas.Reservas.push(['2026-10-0' + (i + 1), '08:00-11:00', '1899999000' + i, 'aguardando sinal', '', 'Bot', 'Rua X, 1']);
  return abas;
};

teste('teto: com 6 pendentes, cliente novo é recusado e alerta sai uma vez só', () => {
  const abas = comPendentes(6);
  const g = criarAmbiente('2026-10-19', abas);
  assert.strictEqual(g.contarPendentes(g.lerReservas_()), 6);
  const r1 = post(g, { data: '2026-10-20', horario: '08:00-11:00', telefone: '18911112222' });
  const r2 = post(g, { data: '2026-10-21', horario: '08:00-11:00', telefone: '18933334444' });
  assert.strictEqual(r1.ok, false);
  assert.ok(r1.erro.includes('WhatsApp'), 'manda o cliente para o WhatsApp');
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(abas.Reservas.length, 7, 'nada gravado');
  assert.strictEqual(g.emails.length, 1, 'um alerta só');
  assert.ok(g.emails[0].subject.includes('Limite de reservas pendentes'));
});

teste('teto: com 5 pendentes ainda aceita; recorrente passa mesmo com teto atingido', () => {
  const g5 = criarAmbiente('2026-10-19', comPendentes(5));
  assert.strictEqual(post(g5, { data: '2026-10-20', horario: '08:00-11:00', telefone: '18911112222' }).ok, true);

  const abas = comPendentes(6);
  abas.Reservas.push(['2026-09-01', '08:00-11:00', '18955556666', 'confirmada', '', 'Cliente fiel', 'Rua Y, 2']);
  const g = criarAmbiente('2026-10-19', abas);
  const r = post(g, { data: '2026-10-20', horario: '08:00-11:00', telefone: '18955556666' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.status, 'confirmada');
});
```

- [ ] **Passo 3: rodar e ver falhar**

Run: `node tests/test.js`
Expected: FAIL com `g.contarPendentes is not a function`.

- [ ] **Passo 4: implementar**

No `CONFIG`, depois de `TEMPO_MINIMO_MS`:

```js
  MAX_PENDENTES: 6,           // reservas "aguardando sinal" ao mesmo tempo, somando todos os números
```

Nas funções puras, abaixo de `motivoAntiBot`:

```js
function contarPendentes(reservas) {
  return reservas.filter(function (r) { return r.status === STATUS.AGUARDANDO; }).length;
}
```

Na seção `/* ============================ Avisos ============================ */`, depois de `avisarReserva_`:

```js
/** Avisa o dono que o teto foi atingido, no máximo uma vez por hora. */
function alertarTeto_(pendentes) {
  const cache = CacheService.getScriptCache();
  if (cache.get('alerta-teto')) return;
  cache.put('alerta-teto', '1', 3600);
  notificarEmail_('⚠️ Limite de reservas pendentes atingido',
    'Há ' + pendentes + ' reservas aguardando sinal. Novos clientes não conseguem reservar pelo site até alguma ser ' +
    'confirmada, cancelada ou expirar. Se não reconhecer esses pedidos, pode ser um bot: confira a aba Reservas.');
}
```

Em `criarReserva_`, logo depois do bloco `// Cliente novo só pode segurar um horário…` (o `if` que retorna "Você já tem uma reserva aguardando o sinal"):

```js
  // Teto geral: impede que alguém trocando de número ocupe a agenda inteira.
  const pendentes = contarPendentes(reservas);
  if (!recorrente && pendentes >= CONFIG.MAX_PENDENTES) {
    alertarTeto_(pendentes);
    return {
      ok: false,
      erro: 'No momento não conseguimos receber novas reservas pelo site. Chame no WhatsApp (18) 99805-1878 para marcar.',
    };
  }
```

- [ ] **Passo 5: rodar e ver passar**

Run: `node tests/test.js`
Expected: `14 testes passaram.`

- [ ] **Passo 6: commit**

```bash
git add apps-script/Code.gs tests/test.js
git commit -m "Limita reservas pendentes de clientes novos e alerta o dono por e-mail"
```

---

### Tarefa 3: expirar sinais não pagos depois de 12 horas

**Arquivos:**
- Modificar: `apps-script/Code.gs` (`CONFIG`, seção Configuração, seção Planilha, funções puras, resposta do Pix)
- Modificar: `tests/test.js` (simulação de `getRange().setValue()`, testes novos)

**Interfaces:**
- Consome: `abaReservas_()`, `notificarEmail_()`, `STATUS` (já existem).
- Produz: `reservasParaExpirar(linhas, agoraMs, horas) → [índices]` (pura; `linhas` sem cabeçalho, índice 0 = linha 2 da planilha); `expirarSinais()` (rodada pelo gatilho); `instalarGatilhos()` (rodada uma vez à mão); `CONFIG.HORAS_EXPIRAR_SINAL`; campo `pix.prazoHoras` na resposta do POST (usado na Tarefa 4).

- [ ] **Passo 1: simular `getRange().setValue()` nos testes**

Em `tests/test.js`, troque o `sheet` por:

```js
  const sheet = (linhas) => ({
    getDataRange: () => ({ getValues: () => linhas.map((l) => l.slice()) }),
    appendRow: (l) => linhas.push(l),
    getRange: (linha, coluna) => ({ setValue: (v) => { linhas[linha - 1][coluna - 1] = v; } }),
  });
```

- [ ] **Passo 2: escrever os testes que falham**

No fim de `tests/test.js`, antes do `console.log` final (o "agora" da simulação é `2026-10-19 12:00` em São Paulo):

```js
teste('expiração: só "aguardando sinal" com mais de 12 h vira cancelada', () => {
  const abas = {
    Horarios: [['Dia', 'Horário', 'Ativo'], ['terça', '08:00-11:00', 'sim'], ['terça', '13:00-16:00', 'sim']],
    Reservas: [['Data', 'Horário', 'Telefone', 'Status', 'Criado em', 'Nome', 'Endereço'],
      ['2026-10-20', '08:00-11:00', '18911110000', 'aguardando sinal', '2026-10-18 23:00:00', 'Velho', 'Rua A, 1'],   // 13 h → expira
      ['2026-10-20', '13:00-16:00', '18922220000', 'aguardando sinal', '2026-10-19 01:00:00', 'Recente', 'Rua B, 2'], // 11 h → fica
      ['2026-10-27', '08:00-11:00', '18933330000', 'confirmada', '2026-10-01 10:00:00', 'Pago', 'Rua C, 3'],          // confirmada → fica
      ['2026-10-27', '13:00-16:00', 'bloqueio', 'aguardando sinal', '', '', ''],                                      // sem data → fica
      ['2026-10-28', '08:00-11:00', '18944440000', 'cancelada', '2026-10-01 10:00:00', 'Antigo', 'Rua D, 4']],       // já cancelada
  };
  const g = criarAmbiente('2026-10-19', abas);
  assert.ok(!g.doGet().slots.some((s) => s.data === '2026-10-20' && s.horario === '08:00-11:00'), 'antes: ocupada');

  g.expirarSinais();

  assert.deepStrictEqual(abas.Reservas.slice(1).map((l) => l[3]),
    ['cancelada', 'aguardando sinal', 'confirmada', 'aguardando sinal', 'cancelada']);
  assert.ok(g.doGet().slots.some((s) => s.data === '2026-10-20' && s.horario === '08:00-11:00'), 'depois: janela volta');
  assert.strictEqual(g.emails.length, 1, 'avisa o dono');
  assert.ok(g.emails[0].body.includes('Velho'));

  g.expirarSinais();
  assert.strictEqual(g.emails.length, 1, 'sem nada novo, não manda e-mail');
});

teste('Pix informa o prazo de pagamento do sinal', () => {
  const g = criarAmbiente('2026-10-19', abasSimples());
  const r = post(g, BASE);
  assert.strictEqual(r.pix.prazoHoras, 12);
});
```

- [ ] **Passo 3: rodar e ver falhar**

Run: `node tests/test.js`
Expected: FAIL com `g.expirarSinais is not a function`.

- [ ] **Passo 4: implementar**

No `CONFIG`, depois de `MAX_PENDENTES`:

```js
  HORAS_EXPIRAR_SINAL: 12,    // "aguardando sinal" mais antigo que isso vira "cancelada" (gatilho de hora em hora)
```

Nas funções puras, abaixo de `contarPendentes`:

```js
/** Índices (0 = linha 2 da planilha) de "aguardando sinal" criados há mais de `horas`. Linhas sem "Criado em" ficam. */
function reservasParaExpirar(linhas, agoraMs, horas) {
  const limite = agoraMs - horas * 3600 * 1000;
  const indices = [];
  linhas.forEach(function (l, i) {
    if (normalizarTexto(l[3]) !== STATUS.AGUARDANDO) return;
    if (!(l[4] instanceof Date) && !String(l[4] == null ? '' : l[4]).trim()) return; // sem "Criado em": linha manual, não mexe
    const criado = l[4] instanceof Date ? l[4].getTime()
      : new Date(String(l[4]).trim().replace(' ', 'T') + '-03:00').getTime(); // "Criado em" é gravado no horário de Brasília
    if (isFinite(criado) && criado < limite) indices.push(i);
  });
  return indices;
}
```

Na seção `/* ============================ Configuração ============================ */`, depois da função `setup`:

```js
/** Rode uma vez pelo editor: agenda `expirarSinais` para rodar de hora em hora. Pode rodar de novo sem duplicar. */
function instalarGatilhos() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'expirarSinais') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('expirarSinais').timeBased().everyHours(1).create();
  console.log('Gatilho instalado: expirarSinais vai rodar a cada 1 hora.');
}
```

Na seção `/* ============================ Planilha ============================ */`, depois de `lerReservas_`:

```js
/** Cancela sinais não pagos dentro do prazo e avisa o dono por e-mail. Chamada pelo gatilho. */
function expirarSinais() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const aba = abaReservas_();
    const linhas = aba.getDataRange().getValues().slice(1);
    const indices = reservasParaExpirar(linhas, new Date().getTime(), CONFIG.HORAS_EXPIRAR_SINAL);
    indices.forEach(function (i) { aba.getRange(i + 2, 4).setValue(STATUS.CANCELADA); });
    console.log('Sinais expirados: ' + indices.length);
    if (!indices.length) return;
    const fuso = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    const lista = indices.map(function (i) {
      const l = linhas[i];
      return '• ' + celulaData_(l[0], fuso) + ' ' + celulaHorario_(l[1], fuso) + ' — ' + l[5] + ' (' + l[2] + ')';
    }).join('\n');
    notificarEmail_('⏰ ' + indices.length + ' reserva(s) expirada(s) sem sinal',
      'Estas reservas passaram de ' + CONFIG.HORAS_EXPIRAR_SINAL + ' h sem pagamento e foram canceladas. ' +
      'As janelas voltaram para o site.\n\n' + lista);
  } finally {
    lock.releaseLock();
  }
}
```

Em `criarReserva_`, no bloco que monta `resposta.pix`, troque:

```js
    resposta.pix = {
      valor: CONFIG.VALOR_SINAL,
      copiaECola: gerarPix(CONFIG.PIX_CHAVE, CONFIG.VALOR_SINAL, CONFIG.PIX_NOME, CONFIG.PIX_CIDADE),
    };
```

por:

```js
    resposta.pix = {
      valor: CONFIG.VALOR_SINAL,
      copiaECola: gerarPix(CONFIG.PIX_CHAVE, CONFIG.VALOR_SINAL, CONFIG.PIX_NOME, CONFIG.PIX_CIDADE),
      prazoHoras: CONFIG.HORAS_EXPIRAR_SINAL,
    };
```

- [ ] **Passo 5: rodar e ver passar**

Run: `node tests/test.js`
Expected: `16 testes passaram.`

- [ ] **Passo 6: commit**

```bash
git add apps-script/Code.gs tests/test.js
git commit -m "Expira sinais não pagos depois de 12 horas e devolve a janela ao site"
```

---

### Tarefa 4: página envia os sinais anti-bot e mostra o prazo do Pix

**Arquivos:**
- Modificar: `web/index.html` (dentro de `#reservas-form`, antes de `#reservas-erro`; texto do prazo no `#reservas-pix`)
- Modificar: `web/reservas.css` (fim do arquivo)
- Modificar: `web/reservas.js` (topo, `apiDemo`, `mostrarResultado`, corpo do POST)

**Interfaces:**
- Consome: contrato da Tarefa 1 (`tempoMs`, `campo_extra`) e `pix.prazoHoras` da Tarefa 3.

- [ ] **Passo 1: campo-armadilha no formulário**

Em `web/index.html`, logo antes de `<p id="reservas-erro" class="reservas-erro" role="alert" hidden></p>`:

```html
        <!-- Campo-armadilha: invisível para pessoas; bots costumam preencher. Não remova. -->
        <div class="reservas-armadilha" aria-hidden="true">
          <label for="reservas-campo-extra">Não preencha este campo</label>
          <input id="reservas-campo-extra" name="campo_extra" type="text" tabindex="-1" autocomplete="off">
        </div>
```

E troque:

```html
          <p class="reservas-info">Seu horário fica reservado enquanto confirmamos o pagamento.</p>
```

por:

```html
          <p id="reservas-prazo" class="reservas-info">Seu horário fica reservado enquanto confirmamos o pagamento.</p>
```

- [ ] **Passo 2: esconder o campo**

No fim de `web/reservas.css`:

```css
/* Campo-armadilha anti-bot: fora da tela, sem sumir do formulário (display:none faria bots ignorarem). */
.reservas-armadilha { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
```

- [ ] **Passo 3: enviar `tempoMs` e `campo_extra`, mostrar o prazo**

Em `web/reservas.js`, logo depois de `const DEMO = new URLSearchParams(location.search).has('demo');`:

```js
  // Anti-bot: o script recusa envios feitos menos de 3 s depois de a página abrir.
  const carregadaEm = Date.now();
```

No corpo do POST, troque:

```js
        body: JSON.stringify({ data, horario, telefone: telefoneEl.value, nome: nomeEl.value, endereco: enderecoEl.value }),
```

por:

```js
        body: JSON.stringify({
          data, horario, telefone: telefoneEl.value, nome: nomeEl.value, endereco: enderecoEl.value,
          tempoMs: Date.now() - carregadaEm, campo_extra: $('reservas-campo-extra').value,
        }),
```

Em `mostrarResultado`, depois de `$('reservas-copia-cola').value = r.pix.copiaECola;`:

```js
    if (r.pix.prazoHoras) {
      $('reservas-prazo').textContent =
        `Pague o sinal em até ${r.pix.prazoHoras} horas. Depois disso, o horário é liberado automaticamente.`;
    }
```

Em `apiDemo`, no objeto `pix` da resposta de cliente novo, troque:

```js
          pix: { valor: 20, copiaECola: 'DEMONSTRACAO-SEM-VALOR-PIX-REAL' } };
```

por:

```js
          pix: { valor: 20, copiaECola: 'DEMONSTRACAO-SEM-VALOR-PIX-REAL', prazoHoras: 12 } };
```

- [ ] **Passo 4: conferir no navegador (modo demo, sem gravar nada)**

Run: abrir `http://localhost:5180/?demo`, esperar 3 s, escolher uma janela, preencher nome, WhatsApp e endereço e clicar em Reservar.
Expected: aparece "Pague o sinal em até 12 horas. Depois disso, o horário é liberado automaticamente."; o campo-armadilha não aparece nem recebe foco com Tab; a página não ganha rolagem lateral no celular (375 px).

- [ ] **Passo 5: commit**

```bash
git add web/index.html web/reservas.css web/reservas.js
git commit -m "Página envia sinais anti-bot e mostra o prazo de 12 h do sinal"
```

---

### Tarefa 5: documentação, publicação e conferência no ar

**Arquivos:**
- Modificar: `docs/CONFIGURACAO.md` (nova seção depois de "3. Publicar o Apps Script como Web App")

- [ ] **Passo 1: documentar**

Em `docs/CONFIGURACAO.md`, logo antes de `## 4. Landing page e reservas`:

```markdown
## Proteção contra bots

Já vem ligada. Os valores ficam no `CONFIG`, no topo do `Code.gs`:

| O quê | Valor | Efeito |
|---|---|---|
| `TEMPO_MINIMO_MS` | 3000 | Recusa envios feitos menos de 3 s depois de abrir a página (bots) |
| campo-armadilha | — | Campo invisível no formulário; se vier preenchido, a reserva é recusada |
| `MAX_PENDENTES` | 6 | Com 6 reservas "aguardando sinal", clientes novos são mandados para o WhatsApp e você recebe um e-mail (no máximo 1 por hora). Clientes que já pagaram antes não são afetados |
| `HORAS_EXPIRAR_SINAL` | 12 | "Aguardando sinal" com mais de 12 h vira `cancelada` sozinho e a janela volta para o site. Você recebe um e-mail com a lista |

**Uma vez só, depois de colar o código:** no Apps Script, rode a função **`instalarGatilhos`**. O Google pede uma autorização nova (para rodar em segundo plano). Confira em **Acionadores** (ícone de relógio) que `expirarSinais` aparece "De hora em hora".

Para conferir uma reserva na hora, sem esperar a expiração, mude o status à mão como sempre.
```

- [ ] **Passo 2: rodar todos os testes**

Run: `node tests/test.js`
Expected: `16 testes passaram.`

- [ ] **Passo 3: commit e um único push (publica o site primeiro)**

```bash
git add docs/CONFIGURACAO.md
git commit -m "Documenta a proteção contra bots"
git push
```

Expected: o Netlify publica sozinho em cerca de 1 minuto (1 publicação, cerca de 15 créditos).

- [ ] **Passo 4: atualizar o script no Google (feito pelo usuário, guiado)**

1. Apps Script → Ctrl+A → colar o novo `apps-script/Code.gs` → Ctrl+S.
2. Rodar **`instalarGatilhos`** e autorizar.
3. **Implantar → Gerenciar implantações → lápis → Versão: Nova versão → Implantar** (a URL `/exec` continua a mesma).

- [ ] **Passo 5: conferir no ar**

Run:
```bash
curl -sL "https://script.google.com/macros/s/AKfycbyEcxBLa9EBoq2MljwwEfN1xBydNvZlqYwuxKa8VU69zC9UY3wGCvTImSpSDoUZAU4W5w/exec" | head -c 120
curl -sL -X POST --data '{"data":"2026-10-28","horario":"08:00-11:00","telefone":"18900000000","nome":"Bot","endereco":"Rua Bot, 1"}' "https://script.google.com/macros/s/AKfycbyEcxBLa9EBoq2MljwwEfN1xBydNvZlqYwuxKa8VU69zC9UY3wGCvTImSpSDoUZAU4W5w/exec"
curl -s https://lavagem-pedrorotta.netlify.app/reservas.js | grep -c "carregadaEm"
```
Expected: o GET devolve `{"ok":true,...`; o POST sem `tempoMs` devolve `{"ok":false,"erro":"Não foi possível concluir a reserva. Recarregue a página…"}` e **não grava nada** na planilha; o `reservas.js` publicado contém `carregadaEm` (`2` ou mais).

- [ ] **Passo 6 (opcional, com OK do usuário): reserva real pelo site**

Fazer uma reserva de teste em `https://lavagem-pedrorotta.netlify.app`, esperando mais de 3 s, conferir que grava, que o texto do prazo de 12 h aparece e depois marcar a linha como `cancelada`.
