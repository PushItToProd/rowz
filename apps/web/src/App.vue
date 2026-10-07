<script setup lang="ts">
import { onBeforeUnmount } from "vue";
import { warnBeforeLeaving } from "./leaveWarning";
import { useWorkbookStore } from "./stores/workbook";
import { useFormulaSessionStore } from "./formula/session";
import DialogHost from "./components/DialogHost.vue";

// Here and not in the editor: a save goes on after the editor is left for the list of spreadsheets.
const workbook = useWorkbookStore();
const formulas = useFormulaSessionStore();
onBeforeUnmount(warnBeforeLeaving(() => workbook.saving || formulas.active !== undefined));
</script>

<template>
  <RouterView />
  <DialogHost />
</template>
