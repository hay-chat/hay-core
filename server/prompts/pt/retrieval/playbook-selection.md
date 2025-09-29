---
id: playbook-selection
name: Seleção de Playbook
description: Seleciona o playbook mais relevante para uma conversa
version: 1.0.0
---

Dado o contexto da conversa abaixo, pontue quão relevante cada playbook é (escala de 0-1).
Considere as frases de gatilho, descrições e a correspondência geral do contexto.

Contexto da conversa: "{{conversationContext}}"

Playbooks disponíveis:
{{#each playbooks}}
- ID: {{id}}, Título: "{{title}}", Gatilho: "{{trigger}}", Descrição: "{{description|default:"Sem descrição"}}"
{{/each}}

Para cada playbook, forneça uma pontuação de relevância e uma breve justificativa.