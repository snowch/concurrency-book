/* cm.h: what every kernel in experiments/ includes.
 *
 * A kernel is freestanding C: no libc, no allocation, no I/O. The same file compiles three ways,
 * and the book quotes it once:
 *
 *   - to WebAssembly with atomics, for the browser laboratory (tools/lower.py, `make wasm`);
 *   - to assembly for x86-64, AArch64 and RISC-V, quoted in the chapters (`make lower`);
 *   - natively, included by native/c/harness.c, which runs it on pthreads at a desk.
 *
 * Every kernel exports the same four functions, so one runtime (web/lab/runtime.js) runs them all:
 *
 *   cm_reset()                    put every shared variable back to its starting value
 *   cm_run(tid, a, b, c)          one worker's whole job; waits at the start barrier first
 *   cm_result(i)                  the i-th result, as a 32-bit integer; -1 past the last
 *   cm_go()                       open the start barrier (the runtime calls this once)
 *
 * The meaning of a, b, c and of each result is the kernel's own, and its experiment.json says.
 */
#ifndef CM_H
#define CM_H

#include <stdatomic.h>
#include <stdint.h>

#ifdef __wasm__
#define CM_EXPORT(name) __attribute__((export_name(name)))
/* Sleep until the word is no longer `expected`, with no timeout: a Wasm `memory.atomic.wait32`.
   The kernel checks the word first; the instruction checks it again before sleeping, so a notify
   that lands between the two is not missed. */
static inline void cm_wait(_Atomic int32_t *word, int32_t expected) {
  __builtin_wasm_memory_atomic_wait32((int32_t *)word, expected, -1);
}
/* Wake every thread sleeping on the word: a Wasm `memory.atomic.notify`. */
static inline void cm_notify(_Atomic int32_t *word) {
  __builtin_wasm_memory_atomic_notify((int32_t *)word, 0x7fffffff);
}
/* Wake one thread sleeping on the word. */
static inline void cm_notify_one(_Atomic int32_t *word) {
  __builtin_wasm_memory_atomic_notify((int32_t *)word, 1);
}
#elif defined(CM_NATIVE_FUTEX) && defined(__linux__)
/* The harness, on Linux: the same two operations are the futex system call, which the C
   library's mutex is built on. The lowering never sees this branch: it compiles freestanding. */
#include <linux/futex.h>
#include <sys/syscall.h>
#include <unistd.h>
#define CM_EXPORT(name)
static inline void cm_wait(_Atomic int32_t *word, int32_t expected) {
  syscall(SYS_futex, word, FUTEX_WAIT_PRIVATE, expected, 0, 0, 0);
}
static inline void cm_notify(_Atomic int32_t *word) {
  syscall(SYS_futex, word, FUTEX_WAKE_PRIVATE, 0x7fffffff, 0, 0, 0);
}
static inline void cm_notify_one(_Atomic int32_t *word) {
  syscall(SYS_futex, word, FUTEX_WAKE_PRIVATE, 1, 0, 0, 0);
}
#else
#define CM_EXPORT(name)
/* Freestanding, or a desk without futexes: a waiter spins, which keeps the kernel correct and
   makes a sleeping lock behave as a spinning one. */
static inline void cm_wait(_Atomic int32_t *word, int32_t expected) {
  while (atomic_load_explicit(word, memory_order_acquire) == expected) {}
}
static inline void cm_notify(_Atomic int32_t *word) { (void)word; }
static inline void cm_notify_one(_Atomic int32_t *word) { (void)word; }
#endif

/* Keep a function out of line, so a loop that calls it in the kernel keeps calling it and the
   function's own instructions are what the fragments show. */
#define CM_NOINLINE __attribute__((noinline))

/* The start barrier. Workers arrive at different times; every run begins when the runtime says. */
static _Atomic int32_t cm_go_flag = 0;

static inline void cm_barrier_wait(void) {
  while (atomic_load_explicit(&cm_go_flag, memory_order_acquire) == 0) cm_wait(&cm_go_flag, 0);
}

CM_EXPORT("cm_go") void cm_go(void) {
  atomic_store_explicit(&cm_go_flag, 1, memory_order_release);
  cm_notify(&cm_go_flag);
}

static inline void cm_barrier_reset(void) {
  atomic_store_explicit(&cm_go_flag, 0, memory_order_relaxed);
}

#endif
