<script setup>
import { ref } from 'vue'
const templateName = ref('新建筑模板')
</script>
<template><main><h1>建筑模板工坊</h1><input v-model="templateName"><p>{{templateName}}</p></main></template>
