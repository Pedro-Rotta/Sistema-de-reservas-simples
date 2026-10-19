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
| terça | 09:00 | sim |
| terça | 14:00 | sim |
| … | … | … |

- Os horários vêm **de exemplo** (09:00, 14:00 e 17:00, de terça a quinta). Edite quando definir os definitivos.
- Para tirar um horário do ar, mude **Ativo** para `não` (ou apague a linha).
- Aceita `terça`, `Terça-feira`, `terca` etc. Horários no formato `HH:mm`.

### Aba Reservas

Colunas: **Data** (`aaaa-mm-dd`), **Horário**, **Telefone** (DDD + número), **Status**, **Criado em**.

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
