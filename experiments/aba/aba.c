/* The ABA problem: a compare-and-swap that succeeds because the value came
 * back, not because nothing changed.
 *
 * ch17 runs a stack of a few nodes that every worker pops from and pushes back
 * to, so that a node leaves and returns while another worker is between its
 * read of the head and its compare-and-swap. The plain pop of ch16 then swings
 * the head to a node that is no longer in the stack. A version counter beside
 * the index, compared and swapped together as one 64-bit word, tells the two
 * apart.
 */
#include "../cm.h"

#define NODES 8

struct node {
  _Atomic int next;
  _Atomic int in_stack; /* 1 while the node is in the stack, 0 while a worker
                           holds it */
};

struct node nodes[NODES];

/* The head as a plain index, and as an index with a version counter in the high
 * half. */
_Atomic int head = 0;
_Atomic int64_t tagged_head = 0;

#define INDEX(h) ((int)((h) & 0xffffffff))
#define TAG(h) ((h) >> 32)
#define MAKE(index, tag) (((int64_t)(tag) << 32) | (uint32_t)(index))

/* Per worker: how many pops returned a node that was not in the stack, and how
 * many pops. */
_Atomic int corruptions[64];
_Atomic int pops_done[64];

CM_NOINLINE void push(int n) {
  int top = atomic_load_explicit(&head, memory_order_relaxed);
  do {
    atomic_store_explicit(&nodes[n].next, top, memory_order_relaxed);
  } while (!atomic_compare_exchange_weak_explicit(&head, &top, n, memory_order_release,
                                                  memory_order_relaxed));
}

/* The pop of ch16: read the top, read the node below, swing the head if the top
   is unchanged. Between the read of the node below and the swing, the top can
   leave and return. */
CM_NOINLINE int pop(void) {
  int top = atomic_load_explicit(&head, memory_order_acquire);
  while (top != 0) {
    int below = atomic_load_explicit(&nodes[top].next, memory_order_relaxed);
    if (atomic_compare_exchange_weak_explicit(&head, &top, below, memory_order_acquire,
                                              memory_order_acquire)) {
      return top;
    }
  }
  return 0;
}

/* The same stack with a version in the head. Every swing of the head adds one
   to the version, so a head that left and returned compares unequal. */
CM_NOINLINE void push_tagged(int n) {
  int64_t top = atomic_load_explicit(&tagged_head, memory_order_relaxed);
  do {
    atomic_store_explicit(&nodes[n].next, INDEX(top), memory_order_relaxed);
  } while (!atomic_compare_exchange_weak_explicit(&tagged_head, &top, MAKE(n, TAG(top) + 1),
                                                  memory_order_release, memory_order_relaxed));
}

CM_NOINLINE int pop_tagged(void) {
  int64_t top = atomic_load_explicit(&tagged_head, memory_order_acquire);
  while (INDEX(top) != 0) {
    int below = atomic_load_explicit(&nodes[INDEX(top)].next, memory_order_relaxed);
    if (atomic_compare_exchange_weak_explicit(&tagged_head, &top, MAKE(below, TAG(top) + 1),
                                              memory_order_acquire, memory_order_acquire)) {
      return INDEX(top);
    }
  }
  return 0;
}

/* a: pop-and-push rounds per worker. b: 0 the plain head, 1 the tagged head. c:
 * unused. */
CM_EXPORT("cm_run") void cm_run(int tid, int a, int b, int c) {
  (void)c;
  cm_barrier_wait();
  int bad = 0, done = 0;
  for (int i = 0; i < a; i++) {
    int n = b == 1 ? pop_tagged() : pop();
    if (n == 0) continue;
    done++;
    /* A node that was not in the stack: the head was swung to a node somebody
     * else held. */
    if (atomic_exchange_explicit(&nodes[n].in_stack, 0, memory_order_relaxed) == 0) bad++;
    atomic_store_explicit(&nodes[n].in_stack, 1, memory_order_relaxed);
    if (b == 1) push_tagged(n);
    else push(n);
  }
  atomic_store_explicit(&corruptions[tid & 63], bad, memory_order_relaxed);
  atomic_store_explicit(&pops_done[tid & 63], done, memory_order_relaxed);
}

CM_EXPORT("cm_reset") void cm_reset(void) {
  /* Three nodes in the stack to start: 1 on top of 2 on top of 3. */
  for (int i = 0; i < NODES; i++) {
    atomic_store_explicit(&nodes[i].next, 0, memory_order_relaxed);
    atomic_store_explicit(&nodes[i].in_stack, 0, memory_order_relaxed);
  }
  for (int n = 1; n <= 3; n++) {
    atomic_store_explicit(&nodes[n].next, n == 3 ? 0 : n + 1, memory_order_relaxed);
    atomic_store_explicit(&nodes[n].in_stack, 1, memory_order_relaxed);
  }
  atomic_store_explicit(&head, 1, memory_order_relaxed);
  atomic_store_explicit(&tagged_head, MAKE(1, 0), memory_order_relaxed);
  for (int i = 0; i < 64; i++) {
    atomic_store_explicit(&corruptions[i], 0, memory_order_relaxed);
    atomic_store_explicit(&pops_done[i], 0, memory_order_relaxed);
  }
  cm_barrier_reset();
}

/* Result 0: pops that returned a node. Result 1: pops that returned a node not
   in the stack. Result 2: nodes in the stack at the end. */
CM_EXPORT("cm_result") int cm_result(int i) {
  if (i == 0 || i == 1) {
    int total = 0;
    for (int w = 0; w < 64; w++) {
      total += atomic_load_explicit(i == 0 ? &pops_done[w] : &corruptions[w], memory_order_relaxed);
    }
    return total;
  }
  if (i == 2) {
    int count = 0, n = atomic_load_explicit(&head, memory_order_relaxed);
    int64_t t = atomic_load_explicit(&tagged_head, memory_order_relaxed);
    if (n == 1 && INDEX(t) != 1) n = INDEX(t);
    while (n != 0 && count < NODES) {
      count++;
      n = atomic_load_explicit(&nodes[n].next, memory_order_relaxed);
    }
    return count;
  }
  return -1;
}
