/**
 * The seccomp filter bubblewrap loads into every sandboxed worker.
 *
 * Docker's default profile has to allow clone/unshare/mount for the container's
 * own user so that bubblewrap can build the sandbox. This filter is applied
 * inside the sandbox, so the worker itself cannot create further namespaces
 * (which would let it undo the mount restrictions), mount filesystems or use
 * the other calls that only administration tools need. Everything else is allowed.
 *
 * bubblewrap reads a raw array of `struct sock_filter` from a file descriptor.
 */

const AUDIT_ARCH_X86_64 = 0xc000003e;
const AUDIT_ARCH_AARCH64 = 0xc00000b7;

const BPF_LD_W_ABS = 0x20;
const BPF_JEQ_K = 0x15;
const BPF_JSET_K = 0x45;
const BPF_RET_K = 0x06;

const SECCOMP_RET_ALLOW = 0x7fff0000;
const SECCOMP_RET_KILL_PROCESS = 0x80000000;
const SECCOMP_RET_ERRNO = 0x00050000;
const EPERM = 1;
const ENOSYS = 38;

/** Namespace flags of clone(2): NEWNS, NEWCGROUP, NEWUTS, NEWIPC, NEWUSER, NEWPID, NEWNET. */
const CLONE_NAMESPACE_FLAGS = 0x7e020000;

interface SyscallTable {
  audit: number;
  /** Refused with EPERM. */
  denied: Record<string, number>;
  clone: number;
  clone3: number;
}

const COMMON_DENIED = [
  "unshare",
  "setns",
  "mount",
  "umount2",
  "pivot_root",
  "chroot",
  "move_mount",
  "open_tree",
  "fsopen",
  "fsconfig",
  "fsmount",
  "fspick",
  "mount_setattr",
  "keyctl",
  "add_key",
  "request_key",
  "ptrace",
  "process_vm_readv",
  "process_vm_writev",
  "kexec_load",
  "init_module",
  "finit_module",
  "delete_module",
  "bpf",
  "perf_event_open",
  "userfaultfd",
  "reboot",
  "swapon",
  "swapoff",
  "sethostname",
  "setdomainname",
] as const;

const X86_64: Record<string, number> = {
  unshare: 272,
  setns: 308,
  mount: 165,
  umount2: 166,
  pivot_root: 155,
  chroot: 161,
  move_mount: 429,
  open_tree: 428,
  fsopen: 430,
  fsconfig: 431,
  fsmount: 432,
  fspick: 433,
  mount_setattr: 442,
  keyctl: 250,
  add_key: 248,
  request_key: 249,
  ptrace: 101,
  process_vm_readv: 310,
  process_vm_writev: 311,
  kexec_load: 246,
  init_module: 175,
  finit_module: 313,
  delete_module: 176,
  bpf: 321,
  perf_event_open: 298,
  userfaultfd: 323,
  reboot: 169,
  swapon: 167,
  swapoff: 168,
  sethostname: 170,
  setdomainname: 171,
};

const AARCH64: Record<string, number> = {
  unshare: 97,
  setns: 268,
  mount: 40,
  umount2: 39,
  pivot_root: 41,
  chroot: 51,
  move_mount: 429,
  open_tree: 428,
  fsopen: 430,
  fsconfig: 431,
  fsmount: 432,
  fspick: 433,
  mount_setattr: 442,
  keyctl: 219,
  add_key: 217,
  request_key: 218,
  ptrace: 117,
  process_vm_readv: 270,
  process_vm_writev: 271,
  kexec_load: 104,
  init_module: 105,
  finit_module: 273,
  delete_module: 106,
  bpf: 280,
  perf_event_open: 241,
  userfaultfd: 282,
  reboot: 142,
  swapon: 224,
  swapoff: 225,
  sethostname: 161,
  setdomainname: 162,
};

function tableFor(arch: string): SyscallTable {
  const pick = (numbers: Record<string, number>) =>
    Object.fromEntries(COMMON_DENIED.map((name) => [name, numbers[name]]));
  if (arch === "x64")
    return { audit: AUDIT_ARCH_X86_64, denied: pick(X86_64), clone: 56, clone3: 435 };
  if (arch === "arm64")
    return { audit: AUDIT_ARCH_AARCH64, denied: pick(AARCH64), clone: 220, clone3: 435 };
  throw new Error(`No seccomp filter for architecture ${arch}`);
}

interface Instruction {
  code: number;
  k: number;
  /** Labels to jump to when the condition holds / does not hold; undefined falls through. */
  jt?: string;
  jf?: string;
}

/** Assemble instructions with symbolic jump targets into the kernel's 8-byte format. */
function assemble(program: Array<Instruction | { label: string }>): Buffer {
  const labels = new Map<string, number>();
  const instructions: Instruction[] = [];
  for (const item of program) {
    if ("label" in item) labels.set(item.label, instructions.length);
    else instructions.push(item);
  }
  const out = Buffer.alloc(instructions.length * 8);
  instructions.forEach((instruction, index) => {
    const offset = (label: string | undefined): number => {
      if (label === undefined) return 0;
      const target = labels.get(label);
      if (target === undefined) throw new Error(`Unknown label ${label}`);
      const distance = target - index - 1;
      if (distance < 0 || distance > 255) throw new Error(`Jump to ${label} out of range`);
      return distance;
    };
    out.writeUInt16LE(instruction.code, index * 8);
    out.writeUInt8(offset(instruction.jt), index * 8 + 2);
    out.writeUInt8(offset(instruction.jf), index * 8 + 3);
    out.writeUInt32LE(instruction.k >>> 0, index * 8 + 4);
  });
  return out;
}

/** The filter for `arch` (Node's process.arch). */
export function buildSeccompFilter(arch: string = process.arch): Buffer {
  const table = tableFor(arch);
  const ld = (k: number): Instruction => ({ code: BPF_LD_W_ABS, k });
  const program: Array<Instruction | { label: string }> = [
    ld(4), // seccomp_data.arch
    { code: BPF_JEQ_K, k: table.audit, jt: "arch-ok" },
    { code: BPF_RET_K, k: SECCOMP_RET_KILL_PROCESS },
    { label: "arch-ok" },
    ld(0), // seccomp_data.nr
    // clone3 passes its flags in memory the filter can't read: report it as
    // missing, and libc falls back to clone, whose flags are checked below.
    { code: BPF_JEQ_K, k: table.clone3, jt: "enosys" },
    { code: BPF_JEQ_K, k: table.clone, jf: "plain", jt: "clone" },
    { label: "clone" },
    ld(16), // clone flags: low half of args[0]
    { code: BPF_JSET_K, k: CLONE_NAMESPACE_FLAGS, jt: "eperm" },
    ld(0),
    { label: "plain" },
  ];
  for (const number of Object.values(table.denied)) {
    program.push({ code: BPF_JEQ_K, k: number, jt: "eperm" });
  }
  program.push(
    { code: BPF_RET_K, k: SECCOMP_RET_ALLOW },
    { label: "eperm" },
    { code: BPF_RET_K, k: SECCOMP_RET_ERRNO | EPERM },
    { label: "enosys" },
    { code: BPF_RET_K, k: SECCOMP_RET_ERRNO | ENOSYS },
  );
  return assemble(program);
}
