export class ApprovalGate {

  pending = new Map()

  wait(id) {
    return new Promise(resolve => {
      this.pending.set(id, resolve)
    })
  }

  approve(id) {
    const r = this.pending.get(id)
    if (r) r()
  }
}
