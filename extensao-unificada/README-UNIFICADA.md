# extensionsIG.avl — extensão unificada v1.63

Esta pasta é a extensão única final. A base é `auto-fluxo` e seus arquivos originais de cadastro, background, publicação e edição de perfil foram preservados. Foram adicionados somente os módulos de encadeamento pós-cadastro e a lógica da extensão `destaque`.

## Fluxo automático

1. O cadastro da extensão-mãe termina e o Instagram retorna para a home ou perfil.
2. O orquestrador grava `archive-running` e ativa “Salvar story em Itens Arquivados”.
3. Vai para `Editar perfil` e reutiliza o editor existente para foto, bio e Story.
4. Depois da criação, a extensão mãe prepara o arquivamento, abre Editar perfil e aciona uma única vez o botão `Configurar perfil` da implementação da `story-pronto`.
5. A implementação da `story-pronto` continua o fluxo de foto, bio, Story, destaque e conversão. A falha ou ausência de confirmação da API do destaque é apenas um aviso e não bloqueia a conversão.
6. Depois da conversão, abre uma nova guia em `http://flashpost.onrender.com/login`, preenche o usuário `guibrjoga`, a senha configurada, clica em `Conectar conta` e confirma `Permitir` quando a tela aparece.
5. Após a conversão, grava `flashpost-opened` e abre uma nova aba em `http://flashpost.onrender.com/login`; o `flow-login.js` existente continua responsável pelo login e por “Conectar conta”.
6. O botão `Ⅱ Pausar fluxo` fica disponível no Instagram. Ao pausar, o orquestrador não redireciona nem repete a etapa anterior; `▶ Retomar fluxo` continua do checkpoint salvo.

## Retomada

Cada etapa é salva em `chrome.storage.local` em uma chave por conta (`extensionsIG.avl.unifiedFlow.v1.<ds_user_id>`) e também em `sessionStorage` para transições rápidas. Ao recarregar ou cair em uma rota inesperada, o orquestrador lê o checkpoint e retorna à URL correta. O Story já confirmado nunca é republicado só por causa de uma recarga.

## Instalação

Extraia o ZIP final e use “Carregar sem compactação” em `chrome://extensions`, com o modo do desenvolvedor ativado. Remova/desative as três extensões antigas para evitar cliques duplicados: a pasta final já contém a mãe, o fluxo story-pronto e o destaque.

A extensão usa a sessão da conta já logada no Instagram. As rotas não oficiais existentes no background foram mantidas; o Instagram pode alterar ou bloquear essas rotas.
