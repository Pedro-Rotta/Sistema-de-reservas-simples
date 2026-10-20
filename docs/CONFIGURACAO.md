# Passo a passo de configuração

Tempo estimado: 20–30 minutos. Tudo é gratuito.

## 1. Planilha + Apps Script

1. Crie uma planilha nova no Google Sheets (ex.: **Reservas – Landing page**).
2. Menu **Extensões → Apps Script**.
3. Apague o conteúdo de `Código.gs` e cole todo o conteúdo de [`apps-script/Code.gs`](../apps-script/Code.gs).
4. No topo do arquivo, revise o bloco `CONFIG`:
   - `PIX_NOME` (até 25 letras, sem acento) e `PIX_CIDADE` (até 15 letras, sem acento) — aparecem no Pix do cliente.
   - Valores (`VALOR_SERVICO`, `VALOR_SINAL`) e chave Pix já estão preenchidos.
5. Salve (Ctrl+S). No seletor de funções, escolha **`setup`** e clique em **Executar**.
   - Na primeira vez o Google pede autorização: **Revisar permissões → sua conta → Avançado → Acessar (não seguro) → Permitir**. É o seu próprio script, por isso o aviso.
6. Volte à planilha: as abas **Horarios** e **Reservas** foram criadas.

### Aba Horarios

| Dia da semana | Horário | Ativo (sim/não) |
|---|---|---|
| terça | 08:00-11:00 | sim |
| terça | 13:00-16:00 | sim |
| … | … | … |

- Já vêm com as janelas de atendimento: **08:00-11:00** e **13:00-16:00**, de terça a quinta. O cliente escolhe a janela, não um horário exato.
- Para tirar um horário do ar, mude **Ativo** para `não` (ou apague a linha).
- Aceita `terça`, `Terça-feira`, `terca` etc. Horário pode ser uma janela (`08:00-11:00`, `8h00 às 11h00`) ou um horário só (`09:00`).

### Aba Reservas

Colunas: **Data** (`aaaa-mm-dd`), **Horário**, **Telefone** (DDD + número), **Status**, **Criado em**, **Nome**, **Endereço**.

- `aguardando sinal` → cliente novo; o horário já fica bloqueado.
- `confirmada` → mude para isso quando o Pix cair. A partir daí o cliente é **recorrente** e as próximas reservas dele são confirmadas direto, sem sinal.
- `cancelada` (ou apagar a linha) → libera o horário.
- **Bloquear uma data específica** (folga, feriado): adicione uma linha com a data, o horário, qualquer texto em Telefone (ex.: `bloqueio`) e status `confirmada`.

## 2. WhatsApp (CallMeBot)

1. Acesse <https://www.callmebot.com/blog/free-api-whatsapp-messages/> e pegue o número atual do bot (ele muda de tempos em tempos).
2. Salve esse número nos contatos do celular e envie pelo WhatsApp a mensagem:
   `I allow callmebot to send me messages`
3. Você recebe de volta uma **apikey**.
4. No Apps Script: **Configurações do projeto (engrenagem) → Propriedades do script → Adicionar propriedade**:
   - `CALLMEBOT_PHONE` = `+5518998051878`
   - `CALLMEBOT_APIKEY` = a apikey recebida
5. No editor, selecione a função **`testarWhatsApp`** e clique em **Executar**. Deve chegar uma mensagem de teste.

> Se o CallMeBot cair ou não estiver configurado, a reserva é gravada normalmente — só o aviso deixa de chegar. Vale conferir a planilha de vez em quando.

## 3. Publicar o Apps Script como Web App

1. No editor: **Implantar → Nova implantação**.
2. Engrenagem ao lado de "Selecionar tipo" → **App da Web**.
3. Preencha:
   - **Executar como:** Eu
   - **Quem pode acessar:** Qualquer pessoa
4. **Implantar** e copie a **URL do app da Web** (termina em `/exec`).
5. Teste abrindo a URL no navegador: deve aparecer um JSON com `"ok":true` e a lista `slots`.

**Ao alterar o código depois:** use **Implantar → Gerenciar implantações → lápis (editar) → Versão: Nova versão → Implantar**. Assim a URL continua a mesma. (Criar uma "Nova implantação" gera outra URL.)

## Proteção contra bots

Já vem ligada. Os valores ficam no `CONFIG`, no topo do `Code.gs`:

| O quê | Valor | Efeito |
|---|---|---|
| `TEMPO_MINIMO_MS` | 3000 | Recusa envios feitos menos de 3 s depois de abrir a página (bots) |
| campo-armadilha | — | Campo invisível no formulário; se vier preenchido, a reserva é recusada |
| `MAX_PENDENTES` | 6 | Com 6 reservas "aguardando sinal", clientes novos são mandados para o WhatsApp e você recebe um e-mail (no máximo 1 por hora). Clientes que já pagaram antes não são afetados |
| `HORAS_EXPIRAR_SINAL` | 12 | "Aguardando sinal" com mais de 12 h vira `cancelada` sozinho e a janela volta para o site. Você recebe um e-mail com a lista |

**Uma vez só, depois de colar o código, nesta ordem:**

1. Na aba Reservas, mude para `confirmada` toda reserva **já paga** que ainda esteja como `aguardando sinal`. Na primeira execução, tudo que estiver "aguardando sinal" há mais de 12 h é cancelado de uma vez.
2. No Apps Script, rode a função **`instalarGatilhos`** e autorize. O Google pede uma permissão nova (para rodar em segundo plano). Confira em **Acionadores** (ícone de relógio) que `expirarSinais` aparece "De hora em hora".
3. Só então publique: **Implantar → Gerenciar implantações → lápis → Nova versão**. Publicar antes de autorizar pode fazer o site parar de responder até a autorização.

**No dia a dia:** marque o Pix como `confirmada` assim que ele cair. Um sinal pago mas ainda não marcado expira junto com os não pagos depois de 12 h, e a janela pode ser reservada por outra pessoa. O e-mail de expiração lista quem foi cancelado.

Para conferir uma reserva na hora, sem esperar a expiração, mude o status à mão como sempre.

## 4. Landing page e reservas

A landing page completa está em `web/index.html` (com a seção de reservas embutida).

1. Abra [`web/reservas.js`](../web/reservas.js) e troque a segunda linha:
   ```js
   const RESERVAS_API_URL = "https://script.google.com/macros/s/SEU_ID/exec";
   ```
   Enquanto estiver vazia, a seção mostra um aviso com link para o WhatsApp.
2. Para ver o fluxo sem a planilha, abra a página com `?demo` no final da URL
   (ex.: `http://localhost:5180/?demo`). Telefone terminado em `1111` simula cliente recorrente.
3. Rodar localmente: `npx http-server web -p 5180` e abrir <http://localhost:5180>.
4. Os pontos a personalizar estão marcados com `EDITAR` no HTML (nome, itens inclusos, fotos, local).
   Fotos vão em `web/img/`. Cores e fontes ficam nos tokens no topo de `web/landing.css`.

## 5. Hospedagem

O repositório é **privado**. O GitHub Pages em repositório privado só funciona em planos pagos, então prefira:

- **Netlify (mais simples):** <https://app.netlify.com/drop> → arraste a pasta `web/`. Ou conecte o repositório e defina *Publish directory* = `web`.
- **Vercel:** importe o repositório e defina *Root Directory* = `web` (framework: Other).
- **GitHub Pages:** só se tornar o repositório público (não há dados sensíveis no código: os telefones ficam na planilha) ou tiver GitHub Pro.

## 6. Rotina do dia a dia

1. Chega no WhatsApp **🆕 NOVO CLIENTE** → confira o Pix de R$ 20.
2. Pagou → mude o status para `confirmada`.
3. Não pagou → mude para `cancelada` (ou apague a linha) para liberar o horário.
4. Cliente recorrente → chega **✅ Nova reserva confirmada**, nada a fazer.

## Testes do script (opcional)

Com Node.js instalado, na raiz do projeto:

```bash
node tests/test.js
```

Roda a lógica do `Code.gs` (horários livres, Pix, telefone, fluxo novo/recorrente) com uma planilha simulada.
