# General Guidelines

- When creating new pages, we should use our internal components, here's an example code and how to use it:

```vue
<template>
  <Page title="My Page" description="This is a description of my page">
    <template #header>
      <Button variant="outline" size="sm" @click="refreshPlugins" :loading="loading">
        Refresh
      </Button>
    </template>

    <Card>
      <CardHeader>
        <CardTitle>My Page</CardTitle>
      </CardHeader>
      <CardContent>
        <p>This is a description of my page</p>
      </CardContent>
    </Card>
  </Page>
</template>
```

## Buttons

**DO:**

```vue
<Button :loading="loading">My Button</Button>
```

**DON'T:**

```vue
<Button :disabled="loading">
  <Loader2 v-if="loading" class="h-4 w-4 mr-2 animate-spin" />
  {{ loading ? "Testing..." : "My Button" }}
</Button>
```

## Inputs

**DO:**

```vue
<Input type="search"label="Search" :icon-start="Search" />
<Input type="select" label="Select" :options="[{ label: 'Option 1', value: 'option1' }, { label: 'Option 2', value: 'option2' }] />
<Input type="switch" label="Switch" />
```

**DON'T:**

```vue
<Label>Search</Label>
<Input :disabled="loading" :value="loading ? 'Loading...' : 'My Input'" />
<Select :disabled="loading" :value="loading ? 'Loading...' : 'My Input'" />
<Switch :disabled="loading" :value="loading ? 'Loading...' : 'My Input'" />
```
