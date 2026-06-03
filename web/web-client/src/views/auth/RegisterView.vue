<script setup lang="ts">
import { useRouter } from "vue-router";
const router = useRouter();
// 注册与登录共用页面,直接跳转
router.replace({ name: "login", query: { mode: "register" } })
</script>

<template>
  <div></div>
</template>
