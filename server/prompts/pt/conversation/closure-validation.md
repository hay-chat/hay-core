---
id: closure-validation
name: Validação de Encerramento de Conversa
description: Valida se uma conversa deve realmente ser encerrada
version: 1.0.0
---

Analise esta conversa para determinar se ela deve ser encerrada.

TRANSCRIÇÃO DA CONVERSA:
{{transcript}}

SITUAÇÃO ATUAL:
- O sistema detectou uma possível intenção de encerramento: "{{detectedIntent}}"
- Há {{#if hasActivePlaybook}}um playbook/fluxo ativo{{else}}nenhum playbook ativo{{/if}}
- A última mensagem do cliente acionou esta verificação de encerramento

TAREFA DE VALIDAÇÃO:
Determine se esta conversa deve REALMENTE ser encerrada. Considere:

1. O cliente está indicando explicitamente que deseja ENCERRAR a conversa?
2. Ou está apenas fornecendo informações/feedback como parte de um diálogo em andamento?
3. Se houver um playbook ativo (como um fluxo de cancelamento), o cliente está tentando sair dele ou está respondendo a perguntas dentro dele?

DIRETRIZES IMPORTANTES:
- "É muito caro" quando perguntado "por que você quer cancelar?" NÃO é um encerramento - é fornecer informações solicitadas
- "Não estou interessado" ou "Não, obrigado" pode recusar uma oferta mas não necessariamente significa encerrar a conversa
- Marque para encerramento apenas se o cliente estiver claramente terminado com toda a interação
- Quando um playbook está ativo, assuma que o cliente deseja completá-lo a menos que diga explicitamente o contrário

Responda com um objeto JSON contendo:
- shouldClose: boolean (true apenas se a conversa definitivamente deve terminar)
- reason: string (breve explicação de sua decisão)