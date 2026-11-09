# extensionsIG.avl v1.46

Correções pontuais sobre a v1.45:

- Quando o AVL preenche os campos mas não consegue validar um dos seletores de data, mostra aviso neutro de conferência, em vez de erro vermelho potencialmente falso. Não envia o cadastro.
- Requisição de destaque tem limite de espera de 35 segundos; ao atingir o limite, a situação fica INCERTA, porque o Instagram ainda pode ter criado o destaque. Confira o perfil antes de fazer qualquer nova tentativa.
- Registra o tempo da tentativa de destaque no diagnóstico em caso de falha.
- Mantém foto, bio, Story, destaque, botões AVL/Outro usuário/Configurar perfil e login do Flow da v1.45.

Aviso: a edição da foto e da bio pode demorar independentemente do destaque. A extensão usa endpoints não oficiais que o Instagram pode alterar ou bloquear. Não há garantia de rapidez ou de publicação.
