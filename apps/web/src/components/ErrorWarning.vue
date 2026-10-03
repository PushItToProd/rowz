<script setup lang="ts">
defineProps<{ label: string }>();
</script>

<template>
  <svg class="error-warning" viewBox="0 0 24 24" role="img" :aria-label="label">
    <path d="M12 3 2 21h20Z" fill="currentColor" />
    <path d="M12 9v5" stroke="white" stroke-width="2" />
    <circle cx="12" cy="17" r="1" fill="white" />
  </svg>
</template>
