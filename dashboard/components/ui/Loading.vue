<template>
  <svg
    width="278"
    height="253"
    viewBox="0 0 278 253"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    class="loading-icon"
  >
    <path
      d="M267.358 244.185C267.358 244.185 73.8552 253 0 253C13.6652 202.001 95.5 229.114 113.738 234.001C162 228.124 191 216.001 200.888 228.124C215 217.001 270.5 206.5 267.358 244.185Z"
      fill="#FF5E33"
      class="peak-base"
    />
    <path
      d="M267.358 244.184C267.358 244.184 232.855 239.5 159 239.5L200.888 150.153C305.764 -86.3931 276.221 129.584 267.358 244.184Z"
      fill="#FF5E33"
      class="peak-3"
    />
    <path
      d="M200.888 150.154C200.888 203.5 204 214.5 204 242H87.5L113.738 156.03C166.914 -30.5621 200.888 -70.2314 200.888 150.154Z"
      fill="#FF5E33"
      class="peak-2"
    />
    <path
      d="M113.738 234C113.738 234 73.8552 253 0 253C60.5611 32.6151 100.443 -104.024 113.738 156.03V234Z"
      fill="#FF5E33"
      class="peak-1"
    />
  </svg>
</template>

<style scoped>
.loading-icon {
  height: 2em;
  width: auto;
}

@keyframes pulse {
  0% {
    transform: scaleY(0.6);
  }
  50% {
    transform: scaleY(1);
  }
}

.peak-1,
.peak-2,
.peak-3 {
  animation: pulse 600ms infinite cubic-bezier(0.4, 0, 0.2, 1) forwards
    alternate;
  transform-origin: bottom;
  --interval: 120ms;
}

.peak-2 {
  animation-delay: var(--interval);
}
.peak-3 {
  animation-delay: calc(var(--interval) * 2);
}
</style>
