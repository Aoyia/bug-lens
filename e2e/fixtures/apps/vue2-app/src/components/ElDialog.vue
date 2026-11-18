<template>
  <div
    v-if="visible"
    role="dialog"
    aria-modal="true"
    class="el-dialog portal-dialog"
    data-testid="portal-dialog"
    style="
      position: fixed;
      right: 24px;
      bottom: 24px;
      background: #fff;
      border: 2px solid #2563eb;
      border-radius: 8px;
      padding: 14px 18px;
      z-index: 9999;
    "
  >
    <div data-testid="portal-title">{{ title }}</div>
    <button
      type="button"
      data-testid="close-portal-btn"
      @click="$emit('close')"
    >
      Close
    </button>
  </div>
</template>

<script>
export default {
  name: "ElDialog",
  props: {
    visible: { type: Boolean, default: false },
    title: { type: String, default: "" },
  },
  watch: {
    visible(val) {
      if (val) {
        this.$nextTick(() => this.attachToBody());
      } else {
        this.detachFromBody();
      }
    },
  },
  mounted() {
    if (this.visible) {
      this.attachToBody();
    }
  },
  beforeDestroy() {
    this.detachFromBody();
  },
  methods: {
    attachToBody() {
      if (
        this.$el &&
        this.$el.nodeType === 1 &&
        this.$el.parentNode !== document.body
      ) {
        document.body.appendChild(this.$el);
      }
    },
    detachFromBody() {
      if (this.$el && this.$el.parentNode === document.body) {
        document.body.removeChild(this.$el);
      }
    },
  },
};
</script>
