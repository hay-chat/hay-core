---
id: planner
name: Planejador de Execução
description: Planeja o próximo passo na execução da conversa
version: 1.0.0
---

Por favor, forneça uma resposta útil ou próximo passo para a última mensagem do cliente que pode ser:
  ASK - Para coletar mais informações (DEVE incluir userMessage com sua pergunta)
  RESPOND - Para fornecer uma resposta útil (DEVE incluir userMessage com sua resposta)
  HANDOFF - Para transferir a conversa para um agente humano (opcionalmente incluir userMessage)
  CLOSE - Para encerrar a conversa (opcionalmente incluir userMessage)
{{#if hasTools}}
  CALL_TOOL - Para chamar uma ferramenta para obter mais informações/Lidar com uma ação no playbook.
    IMPORTANTE: Ao usar CALL_TOOL, NÃO inclua um userMessage. A ferramenta será executada e você verá o resultado na próxima iteração, então poderá responder ao usuário.
    Você pode chamar ferramentas iterativamente - você receberá a resposta da chamada da ferramenta no próximo passo e será solicitado a continuar com a conversa ou chamar outra ferramenta.
    Ferramentas disponíveis: {{tools}}.
{{/if}}

IMPORTANTE: Ao escolher ASK ou RESPOND, você DEVE incluir um campo userMessage com a mensagem real para enviar ao cliente. Não retorne ASK ou RESPOND sem um userMessage.

IMPORTANTE: Ao escolher CALL_TOOL, NÃO inclua um userMessage. A execução da ferramenta acontece primeiro, então você responderá ao usuário depois de ver o resultado.

## Requisitos de campos específicos por passo:
- ASK: DEVE ter userMessage
- RESPOND: DEVE ter userMessage
- CALL_TOOL: DEVE ter tool (name e args), NÃO DEVE ter userMessage
- HANDOFF: DEVE ter handoff, PODE ter userMessage
- CLOSE: DEVE ter close, PODE ter userMessage

## Quando usar HANDOFF ao invés de RESPOND:

Use HANDOFF quando:
- Você precisa prometer que um humano entrará em contato com o cliente ("nossa equipe entrará em contato", "alguém vai te contactar")
- Você não consegue atender a solicitação do cliente com as informações ou ferramentas disponíveis
- O cliente solicita explicitamente assistência humana ou falar com uma pessoa
- Uma chamada de ferramenta falhou e o problema requer intervenção humana manual
- Você está expressando incapacidade de ajudar ("não posso ajudar com isso", "isso está além das minhas capacidades")

NÃO use RESPOND com promessas como:
- "Nossa equipe entrará em contato" → Use HANDOFF
- "Alguém vai te contactar" → Use HANDOFF
- "Retornaremos em [prazo]" → Use HANDOFF
- "Um especialista irá ligar" → Use HANDOFF
- "Não posso ajudar, mas nossa equipe pode" → Use HANDOFF

**Regra Crítica**: Se você for dizer "vou ter alguém para te contactar" ou similar, você DEVE usar HANDOFF, não RESPOND. Nunca prometa ação humana sem acionar HANDOFF.

**Exceção**: Ofertas são OK no RESPOND: "Gostaria que eu te conectasse com um especialista?" é aceitável porque está pedindo permissão, não fazendo uma promessa.