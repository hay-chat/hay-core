<template>
  <div class="flex items-center justify-between px-2">
    <!-- Items per page selector on the left -->
    <div class="flex items-center space-x-2">
      <p class="text-sm font-medium whitespace-nowrap">Rows per page</p>
      <Input
        :model-value="itemsPerPage"
        type="select"
        class="h-8"
        :options="[
          { label: '10', value: 10 },
          { label: '20', value: 20 },
          { label: '50', value: 50 },
          { label: '100', value: 100 },
        ]"
        @update:model-value="handleItemsPerPageChange"
      />
    </div>

    <!-- Pagination controls on the right -->
    <div class="flex items-center space-x-6 lg:space-x-8">
      <div class="flex w-[100px] items-center justify-center text-sm font-medium">
        Page {{ currentPage }} of {{ totalPages }}
      </div>
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              :disabled="currentPage <= 1"
              :class="currentPage <= 1 ? 'opacity-50 cursor-not-allowed' : ''"
              @click="handlePageChange(currentPage - 1)"
            />
          </PaginationItem>

          <!-- Page numbers -->
          <template v-for="page in visiblePages" :key="page">
            <PaginationItem v-if="page === 'ellipsis-start' || page === 'ellipsis-end'">
              <PaginationEllipsis />
            </PaginationItem>
            <PaginationItem v-else>
              <PaginationLink
                :is-active="page === currentPage"
                @click="handlePageChange(page as number)"
              >
                {{ page }}
              </PaginationLink>
            </PaginationItem>
          </template>

          <PaginationItem>
            <PaginationNext
              :disabled="currentPage >= totalPages"
              :class="currentPage >= totalPages ? 'opacity-50 cursor-not-allowed' : ''"
              @click="handlePageChange(currentPage + 1)"
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  </div>
</template>

<script setup lang="ts">
export interface DataPaginationProps {
  currentPage: number;
  totalPages: number;
  itemsPerPage: number;
  totalItems?: number;
}

const props = withDefaults(defineProps<DataPaginationProps>(), {
  currentPage: 1,
  totalPages: 1,
  itemsPerPage: 10,
});

const emit = defineEmits<{
  "page-change": [page: number];
  "items-per-page-change": [itemsPerPage: number];
}>();

const handlePageChange = (page: number) => {
  if (page >= 1 && page <= props.totalPages && page !== props.currentPage) {
    emit("page-change", page);
  }
};

const handleItemsPerPageChange = (value: string | number | boolean) => {
  if (typeof value === "boolean") return;
  const itemsPerPage = Number(value);
  emit("items-per-page-change", itemsPerPage);
};

// Calculate visible page numbers with ellipsis
const visiblePages = computed(() => {
  const pages: (number | string)[] = [];
  const total = props.totalPages;
  const current = props.currentPage;

  if (total <= 7) {
    // Show all pages if total is 7 or less
    for (let i = 1; i <= total; i++) {
      pages.push(i);
    }
  } else {
    // Always show first page
    pages.push(1);

    if (current > 3) {
      pages.push("ellipsis-start");
    }

    // Show pages around current page
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    if (current < total - 2) {
      pages.push("ellipsis-end");
    }

    // Always show last page
    pages.push(total);
  }

  return pages;
});
</script>
