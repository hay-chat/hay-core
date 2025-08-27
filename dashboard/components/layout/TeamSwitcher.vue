<template>
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button
        v-if="activeTeam"
        class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <div class="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <component :is="activeTeam.logo" class="size-4" />
        </div>
        <div class="flex-1 text-left">
          <p class="font-semibold">{{ activeTeam.name }}</p>
          <p class="text-xs text-muted-foreground">{{ activeTeam.plan }}</p>
        </div>
        <ChevronsUpDown class="ml-auto size-4" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent class="w-[--radix-dropdown-menu-trigger-width]" align="start">
      <DropdownMenuItem
        v-for="team in teams"
        :key="team.name"
        @click="setActiveTeam(team)"
        class="gap-2 p-2"
      >
        <div class="flex aspect-square size-8 items-center justify-center rounded-lg bg-muted">
          <component :is="team.logo" class="size-4" />
        </div>
        <div class="flex-1">
          <p class="font-medium">{{ team.name }}</p>
          <p class="text-xs text-muted-foreground">{{ team.plan }}</p>
        </div>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem class="gap-2 p-2">
        <div class="flex aspect-square size-8 items-center justify-center rounded-lg bg-muted">
          <Plus class="size-4" />
        </div>
        <div class="font-medium">Add team</div>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ChevronsUpDown, Plus, Building2, Users2, Briefcase } from 'lucide-vue-next'

const teams = [
  {
    name: 'Acme Inc',
    logo: Building2,
    plan: 'Enterprise',
  },
  {
    name: 'Startup Co',
    logo: Users2,
    plan: 'Startup',
  },
  {
    name: 'Freelance',
    logo: Briefcase,
    plan: 'Free',
  },
]

const activeTeam = ref(teams[0])

const setActiveTeam = (team: typeof teams[0]) => {
  activeTeam.value = team
}
</script>