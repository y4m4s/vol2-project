/** 非同期処理の準備区間を含め、同時に 1 件だけ開始させる同期ガード。 */
export class SingleFlightGate {
  private active = false;

  public tryAcquire(): (() => void) | undefined {
    if (this.active) {
      return undefined;
    }

    this.active = true;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.active = false;
    };
  }
}
