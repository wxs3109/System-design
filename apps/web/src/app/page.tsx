import { Workbench } from '@/components/workbench'
import { ExperimentBoundary } from '@/components/experiments/recovery-boundary'

export default function Home() {
  return <ExperimentBoundary><Workbench /></ExperimentBoundary>
}
