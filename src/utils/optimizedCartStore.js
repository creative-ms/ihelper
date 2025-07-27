
// 3. OPTIMIZED CART STORE WITH WEB WORKERS
// File: src/stores/optimizedCartStore.js
import { create } from 'zustand';

class WorkerManager {
  constructor() {
    this.worker = null;
    this.initWorker();
  }
  
  initWorker() {
    const blob = new Blob([cartCalculationsWorker], { type: 'application/javascript' });
    this.worker = new Worker(URL.createObjectURL(blob));
    
    this.worker.onmessage = (e) => {
      const { type, data } = e.data;
      this.handleWorkerMessage(type, data);
    };
  }
  
  calculateTotals(items) {
    return new Promise((resolve) => {
      this.pendingCalculation = resolve;
      this.worker.postMessage({ type: 'CALCULATE_TOTALS', items });
    });
  }
  
  handleWorkerMessage(type, data) {
    switch(type) {
      case 'TOTALS_CALCULATED':
        if (this.pendingCalculation) {
          this.pendingCalculation(data);
          this.pendingCalculation = null;
        }
        break;
    }
  }
}

const workerManager = new WorkerManager();