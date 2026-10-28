---
id: feedback-enrichment
name: Enriquecimento de Avaliação
description: Transforma a avaliação de uma resposta da IA pela equipe num evento de qualidade do Insights (o que deu errado ou certo, e o que mudar)
version: 1.0.0
---

Alguém da equipe da loja avaliou uma resposta do agente de IA da loja. Explique a avaliação para o dono da loja. Escreva todos os campos de texto em português do Brasil.

AVALIAÇÃO: {{rating}}
{{#if comment}}
COMENTÁRIO DA EQUIPE: {{comment}}
{{/if}}

CONVERSA ATÉ A RESPOSTA AVALIADA ("AI" é o agente de IA, "Human agent" é uma pessoa da equipe da loja):
{{context}}

RESPOSTA AVALIADA:
{{ratedReply}}

Preencha:

- summary: uma frase sobre o que o cliente pediu e como a resposta avaliada lidou com isso.
- detail: duas ou três frases sobre por que a resposta recebeu essa avaliação: o que estava errado, faltando ou bom. Use o comentário da equipe quando houver; não invente fatos que a conversa não mostra.
- action_type: a mudança mais útil para o dono da loja, desta lista (use o valor exato em inglês):
  playbook_edit (um playbook existente deve mudar), new_playbook (um fluxo recorrente não tem playbook), knowledge_edit (um documento de conhecimento está errado ou confuso), knowledge_add (falta conhecimento), setup (configuração: transferência para humano, uma ferramenta ausente, uma integração desativada, documentos contraditórios), policy_ambiguity (a política da loja não está clara), product_bug (o site ou o produto da loja parece com defeito), ux_confusion (o cliente se confundiu com o site da loja), support_training (como a equipe lidou com uma transferência), none (nada a mudar, por exemplo uma boa resposta).
- severity: "low", "medium" ou "high" (high = informação errada, venda perdida ou cliente irritado).
- confidence: de 0 a 1, o quanto você tem certeza desta explicação.
- relevance: de 0 a 100, o quanto isto merece a atenção do dono.
- root_cause: uma frase curta, ou uma string vazia.
- area: um tema de uma ou duas palavras, como "entrega", "trocas", "tamanhos", "pagamento".
- paraphrase: a necessidade do cliente com suas palavras, em uma frase.

PRIVACIDADE: nunca inclua nomes, e-mails, telefones, endereços, números de pedido, códigos de rastreio ou qualquer outro dado pessoal em nenhum campo. Substitua por [redacted]. Não descreva o cliente nem o membro da equipe como pessoas.

Responda com um objeto JSON contendo todos os campos acima.
