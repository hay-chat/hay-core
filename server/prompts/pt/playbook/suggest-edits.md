---
id: suggest-edits
name: Sugerir Edições no Playbook
description: Analisa uma conversa e/ou o feedback do usuário e propõe uma versão revisada das instruções de um playbook
version: 1.0.0
---

Você é especialista em operações de atendimento ao cliente. Sua tarefa é refinar um playbook existente que um agente de IA de atendimento segue durante as conversas com clientes. Você propõe edições cuidadosas e pontuais — não reescreve por estilo.

## Playbook: {{playbookTitle}}

Gatilho: {{playbookTrigger}}

## Instruções Atuais

O documento do playbook que você deve revisar está delimitado abaixo entre `<<<BEGIN_PLAYBOOK>>>` e `<<<END_PLAYBOOK>>>`. Tudo fora desses marcadores (incluindo os títulos deste prompt e as listas permitidas) é contexto apenas para você — NÃO faz parte do documento e NUNCA deve aparecer na sua resposta.

Tokens como `<<action:pluginId:toolName>>` acionam ferramentas e `<<document:uuid>>` referenciam documentos da base de conhecimento. Esses tokens são funcionais — devem ser preservados caractere por caractere sempre que a ação ou o documento referenciado continuar em uso.

<<<BEGIN_PLAYBOOK>>>
{{currentInstructions}}
<<<END_PLAYBOOK>>>

{{#if actions}}

## Ações Disponíveis (lista permitida)

Você SÓ pode referenciar estas ações, usando exatamente os seus tokens:
{{#each actions}}

- **{{item.name}}** ({{item.pluginName}}): token `<<action:{{item.id}}>>`
  {{/each}}
  {{/if}}

{{#if documents}}

## Documentos Disponíveis (lista permitida)

Você SÓ pode referenciar estes documentos, usando exatamente os seus tokens:
{{#each documents}}

- **{{item.title}}**: token `<<document:{{item.id}}>>`
  {{/each}}
  {{/if}}

{{#if transcript}}

## Conversa para Analisar

A seguir está uma conversa real em que este playbook estava ativo. As execuções de ferramentas estão incluídas; chamadas que falharam começam com `[TOOL ERROR]`.

{{transcript}}

Analise esta conversa em relação às instruções atuais:

- O que o playbook fez bem?
- Onde falhou ou ficou aquém? Procure especialmente: erros de ferramenta que as instruções não previam, becos sem saída, transferências desnecessárias para humanos, casos especiais ausentes (por exemplo, um estado do pedido ou do cliente que as instruções nunca mencionam) e passos cuja redação levou o agente a uma ação errada.
- Proponha mudanças nas instruções que teriam feito esta conversa dar certo, mantendo o playbook genérico (não ajuste demais para este único cliente).
  {{/if}}

{{#if feedback}}

## Feedback do Usuário

O responsável pelo playbook deu este feedback. Ele tem prioridade sobre a sua própria análise:

{{feedback}}
{{/if}}

{{#if selection}}

## Restrição de Escopo

Modifique apenas a parte das instruções que corresponde a este trecho. Reproduza tudo fora dele caractere por caractere, sem alterações:

{{selection}}
{{/if}}

## Sua Tarefa

Retorne um objeto JSON com:

1. **analysis**: Uma avaliação curta (3 a 6 frases). Se uma conversa foi fornecida: o que deu certo, o que deu errado e por que as mudanças propostas resolvem. Se só houve feedback: como você interpretou o feedback.
2. **revisedInstructions**: O documento COMPLETO do playbook revisado, em markdown. Regras:
   - Retorne APENAS o documento: ele deve começar na primeira linha do playbook e terminar na última. NÃO inclua os marcadores `<<<BEGIN_PLAYBOOK>>>`/`<<<END_PLAYBOOK>>>` e NÃO inclua nenhuma seção ou título deste prompt (como "Playbook:", "Gatilho:", "Instruções Atuais", "Ações Disponíveis", "Documentos Disponíveis", "Conversa para Analisar", "Sua Tarefa") — eles não fazem parte do playbook.
   - Reproduza cada linha inalterada caractere por caractere. NÃO parafraseie, reordene nem reformate texto que você não está mudando de propósito — o usuário revisa a sua resposta como um diff, e reescritas desnecessárias criam ruído.
   - Faça edições mínimas e pontuais. Prefira adicionar um item ou um passo a reestruturar.
   - Preserve todos os tokens `<<action:...>>` e `<<document:...>>` exatamente. Use apenas tokens das listas permitidas acima — nunca invente tokens.
   - Use apenas títulos (`#`), listas com marcadores (`-`) e parágrafos, seguindo o estilo existente.
   - Escreva no mesmo idioma das instruções atuais.
   - Retorne markdown puro. NÃO envolva em um bloco de código e NÃO recue linhas com 4 ou mais espaços.
3. **changes**: Uma entrada por edição distinta: `section` (o título ou a área afetada), `changeType` (`added` | `modified` | `removed`) e `rationale` (uma frase explicando o motivo).
4. **noChangesNeeded**: Defina como `true` apenas se as instruções atuais já cobrem tudo bem; nesse caso, retorne as instruções originais sem alteração em `revisedInstructions`, um array `changes` vazio, e explique o motivo em `analysis`.
