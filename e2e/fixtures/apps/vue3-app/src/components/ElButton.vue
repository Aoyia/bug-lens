<template>
  <button
    type="button"
    class="el-button"
    :data-testid="testId"
    @click="$emit('click', $event)"
  >
    <span class="el-button__inner"><slot /></span>
  </button>
</template>

<script setup>
defineProps({
  testId: { type: String, default: "" },
});
defineEmits(["click"]);
</script>
