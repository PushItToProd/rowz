<script setup lang="ts">
import { onBeforeUnmount } from "vue";
import { warnBeforeLeaving } from "./leaveWarning";
import { useWorkbookStore } from "./stores/workbook";

// Here and not in the editor: a save goes on after the editor is left for the list of spreadsheets.
const workbook = useWorkbookStore();
onBeforeUnmount(warnBeforeLeaving(() => workbook.saving));
</script>

<template>
  <RouterView />
</template>
