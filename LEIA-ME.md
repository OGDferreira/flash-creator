# Flash Creator

App único que junta os dois programas anteriores:

- **Monitor de códigos do Gmail** (o antigo *Gmail Watcher*): navegadores embutidos, um por conta, que leem o feed do Gmail e capturam os códigos de 6 dígitos.
- **Automação de perfis Dolphin Anty** (o antigo *Auto Conectar*): cria perfis em lote, uma proxy por perfil, abre todos, divide a tela e espelha cliques.

Mais as novidades que você pediu: cards com **cor/status**, **fila** reorganizada, **login persistente** e uma **API local** para a sua extensão do Chrome.

---

## Como rodar

Precisa do **Node.js 18+** instalado (https://nodejs.org — versão LTS).

1. Dê dois cliques em **`iniciar.bat`** (na primeira vez ele instala o Electron sozinho e depois abre o app).
   - Ou, no terminal, dentro da pasta: `npm install` e depois `npm start`.
2. Para gerar um `.exe` standalone (opcional): `npm run dist` — a pasta `dist\` sai com o app empacotado.

Os dados (contas, códigos, proxies, token, configurações) ficam em
`%APPDATA%\flash-creator\data.json`. O log fica em `%APPDATA%\flash-creator\log.txt`.

---

## Aba Códigos — cores, status e fila

Cada Gmail é um card com uma **cor de status**:

- 🟢 **Verde = disponível** — recebeu **menos de 6** códigos nos últimos **4 dias**.
- 🔴 **Vermelho = indisponível** — recebeu **6 ou mais** códigos na janela de 4 dias. Ele **volta a verde sozinho** quando esses códigos passam dos 4 dias (a janela é móvel).
- Clique no **ponto de status** do card para **fixar a cor manualmente** (automático → verde → vermelho → automático). Quando está fixo, o ponto fica com uma borda branca.

**Fila:**
- Verdes ficam **no topo**, vermelhos vão **para o fim**.
- Quando um Gmail **recebe um código novo**, ele sobe para o **primeiro** da sua faixa.
- **Selecionar ou copiar** um card **não muda a ordem** (diferente do app antigo, que jogava o ativo para o topo). Se ele está em segundo e você copia, continua em segundo.

O limite (6) e a janela (4 dias) podem ser mudados em **Configurações › Regra de status**.

## Aba Contas Gmail — login persistente

Cada Gmail abre numa **sessão isolada e persistente** (`persist:gmail-N`). Faça login **uma vez**; ao fechar e reabrir o app, **os Gmails continuam logados** — nada é deslogado. O e-mail é detectado sozinho depois do login.

As janelas de Gmail usam o **IP do próprio PC (sem proxy)**, de propósito — proxy aqui é só para os perfis Dolphin.

## Abas Perfis Dolphin / Proxies

Mesmas funções do Auto Conectar: token da API em **Configurações**, proxies na aba **Proxies**, criação em lote, abrir perfis, dividir a tela em grade e espelhamento de cliques entre os perfis abertos.

### Proxies direto da Allan Proxys (API)

Na aba **Proxies**, o card **Allan Proxys (direto da API)** puxa suas proxies da conta sem copiar e colar:

1. Em **allanproxys.com › Meu Perfil › Chave de API**, crie uma chave e cole no campo **Chave da API**. Para rotacionar IP pelo app, crie a chave com permissão **leitura e configuração**; só para importar, a de **leitura** basta.
2. A API **não entrega a senha** das proxies (por segurança). Pegue a senha em **Meu Perfil › Credenciais** e cole uma vez no campo **Senha das proxies** — ela é aplicada a todas as proxies importadas.
3. **Importar proxies da API** traz host, porta, login, país e GB de cada proxy e joga no pool. Reimportar atualiza sem perder as que já foram usadas. A partir daí a criação de perfis usa essas proxies como qualquer outra — cada perfil pega uma diferente.
4. **Atualizar saldos (GB)** mostra o GB disponível de cada proxy (fica vermelho quando está sem senha).
5. **↻ IP** em cada proxy Allan troca a localização e pega um IP novo (precisa da chave de configuração; proxies que não aceitam isso retornam aviso).

A chave e a senha ficam só no seu PC, no `data.json`. Limites da API: 60 consultas/min, 6/min no teste de proxy — o app respeita isso consultando sob demanda.

### Perfis Dolphin usam só Mobile 4G

Cada proxy tem uma **categoria**: `Mobile 4G`, `Residencial` ou `Geral`. No import da Allan ela é detectada sozinha pelo nome do plano; no "adicionar manualmente" você escolhe no campo **Categoria**.

Na aba **Perfis Dolphin**, a opção **"Somente proxies Mobile 4G"** (ligada por padrão) faz a criação usar **só proxies 4G, uma diferente por perfil**. O contador mostra quantas 4G estão livres. Se quiser usar qualquer proxy, é só desligar essa opção.

---

## Gerar o executável (.exe)

Dois cliques em **`gerar_exe.bat`**. Ele instala o necessário e gera, na pasta `dist\`:

- **`dist\win-unpacked\`** — pasta portátil. Abra o **`Flash Creator.exe`** dentro dela. Para levar para outro PC, copie a pasta inteira (não só o .exe).

A primeira geração baixa o Electron, então demora um pouco. Precisa de internet e do Node.js instalado. Não precisa de permissão de administrador.

---

## API local para a sua extensão do Chrome

Na aba **API / Extensão** o app sobe um servidor em `http://127.0.0.1:8777` (porta configurável), protegido por um **token** (gerado por PC). Ele entrega exatamente o que você pediu:

1. **Os Gmails disponíveis** (os verdes).
2. **Quando um Gmail recebe um código**, faz push de `{ email, code }` na hora.

### Endpoints
| Rota | O que devolve |
|---|---|
| `GET /api/available` | Gmails disponíveis (verdes): `[{ email, count }]` |
| `GET /api/codes?email=...` | códigos de um Gmail |
| `GET /api/latest?email=...` | último código |
| `WS /ws` | push em tempo real de cada código novo |

Mande o token em `?token=SEU_TOKEN` ou no header `X-Token`.

### Payload do código (o principal, via WebSocket)
```json
{ "type": "code", "email": "exemplo@gmail.com", "code": "123456",
  "subject": "Seu código", "sender": "Google", "received_at": "05/11/2026 17:02:11" }
```

### Resposta de `/api/available`
```json
{ "available": [ { "email": "conta1@gmail.com", "count": 2 } ] }
```

### Extensão de exemplo
A pasta **`extensao-exemplo\`** já traz uma extensão pronta (Manifest V3) para carregar em **modo desenvolvedor** (`chrome://extensions` → *Carregar sem compactação*):

- `background.js` — conecta no WebSocket, recebe os códigos e guarda os disponíveis.
- `popup.html` / `popup.js` — cole o **token** da aba API e veja os Gmails disponíveis e os últimos códigos.

Depois de carregar, abra o popup, cole o token (está na aba **API / Extensão** do app) e salve. É só adaptar o `background.js` para o que você precisa.

> **Nota do MV3:** o service worker do Chrome pode ser desligado quando fica ocioso; o exemplo usa `chrome.alarms` para reconectar sozinho a cada minuto.
