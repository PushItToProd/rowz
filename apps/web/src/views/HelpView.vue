<script setup lang="ts">
import { computed } from "vue";
import { usePageTitle } from "../pageTitle";
import { HELP_PAGES } from "./help/pages";
import Editing from "./help/HelpEditing.vue";
import Tables from "./help/HelpTables.vue";
import Formulas from "./help/HelpFormulas.vue";
import Functions from "./help/HelpFunctions.vue";
import Queries from "./help/HelpQueries.vue";
import Actions from "./help/HelpActions.vue";
import Presentation from "./help/HelpPresentation.vue";
import Documents from "./help/HelpDocuments.vue";

const props = withDefaults(defineProps<{ topic?: string }>(), { topic: "editing" });
const page = computed(() => HELP_PAGES.find(({ id }) => id === props.topic) ?? HELP_PAGES[0]);
const components = {
  editing: Editing,
  tables: Tables,
  formulas: Formulas,
  functions: Functions,
  queries: Queries,
  actions: Actions,
  presentation: Presentation,
  documents: Documents,
};
usePageTitle(() => `${page.value.title} · Help`);
</script>

<template>
  <div class="help">
    <header class="help__header">
      <RouterLink :to="{ name: 'spreadsheets' }">← Documents</RouterLink>
      <h1>Help</h1>
    </header>
    <nav class="help__contents" aria-label="Help topics">
      <RouterLink
        v-for="item in HELP_PAGES"
        :key="item.id"
        :to="{ name: 'help', params: { topic: item.id } }"
        :aria-current="item.id === page.id ? 'page' : undefined"
        >{{ item.title }}</RouterLink
      >
    </nav>
    <component :is="components[page.id]" />
    <nav class="help__pagination" aria-label="More help topics">
      <RouterLink
        v-if="HELP_PAGES.indexOf(page) > 0"
        :to="{ name: 'help', params: { topic: HELP_PAGES[HELP_PAGES.indexOf(page) - 1]!.id } }"
        >← {{ HELP_PAGES[HELP_PAGES.indexOf(page) - 1]!.title }}</RouterLink
      >
      <RouterLink
        v-if="HELP_PAGES.indexOf(page) < HELP_PAGES.length - 1"
        :to="{ name: 'help', params: { topic: HELP_PAGES[HELP_PAGES.indexOf(page) + 1]!.id } }"
        >{{ HELP_PAGES[HELP_PAGES.indexOf(page) + 1]!.title }} →</RouterLink
      >
    </nav>
  </div>
</template>
