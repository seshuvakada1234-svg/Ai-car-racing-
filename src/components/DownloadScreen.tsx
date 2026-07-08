/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { motion } from "motion/react";

interface DownloadProgressProps {
  label: string;
  percent: number;
}

export const DownloadProgress: React.FC<DownloadProgressProps> = ({ label, percent }) => {
  return (
    <div className="space-y-1.5" id={`dl-prog-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex justify-between text-xs font-mono text-slate-300">
        <span className="font-medium text-slate-200">{label}</span>
        <span className="font-bold text-emerald-400">{percent}%</span>
      </div>
      <div className="h-2.5 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-900">
        <motion.div
          className="h-full bg-linear-to-r from-emerald-500 to-teal-400 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.1, ease: "easeOut" }}
        />
      </div>
    </div>
  );
};
