<script setup lang="ts">
import { onMounted } from "vue";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();

onMounted(() => {
  if (!auth.ready) {
    void auth.initialize();
  }
});
</script>

<template>
  <router-view />
</template>
