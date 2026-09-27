import type { ConceptBody } from '../types'
export const decisionPatterns:Readonly<Record<string,ConceptBody>>={
  'sync-async-boundaries':{
    problem:'选择同步或异步，先问调用者何时需要结果、响应承诺了哪个阶段，以及工作失败后怎样查询和恢复。编程接口不阻塞线程，与业务是否等待处理完成，是两个不同维度。',
    example:['一个请求需要较长处理，用户允许稍后查看结果。','服务先确认受理并返回任务身份，后台继续处理。','后台失败后必须保存失败状态；受理响应不会自动变成完成成功。'],
    mechanism:['把受理、稳定接纳、处理完成和对用户可见分别定义。异步可以缩短受理等待、缓冲突发，但没有增加长期处理能力。','调用者仍需要状态查询或通知、幂等提交、超时和取消语义。消息已确认、Worker 已处理和业务效果已提交需要不同证据。'],
    conditions:['必须立即拿到结果才能继续的操作，需要相应的等待或交互协议。','取消请求不代表已经产生的效果被撤销，补偿需要业务规则。','本平台复用 ACK/Checkpoint、Outbox、重试和过载实验验证这些边界，不部署消息中间件。'],
    counterexample:'生产者每秒接纳 100 个任务，消费者长期只能处理 60 个。加一个无限队列会让等待持续增长，不能承诺任务及时完成。',
    check:{question:'返回任务编号以后，能否把这项业务计为完成？',answer:'只能按约定计为受理；还需要处理结果、效果提交和可见性的证据。'},
    decisionGuide:[{when:'调用者允许结果稍后可见',consider:'评估异步任务和可查询状态',tradeoff:'增加积压、重投、去重和状态维护责任。'},{when:'操作结果决定调用者的下一步',consider:'保留明确的等待与失败反馈',tradeoff:'需要端到端期限、资源预算和依赖故障处理。'},{when:'只是短时峰值超过处理能力',consider:'有限排队与背压',tradeoff:'要计算可接受等待；长期超载仍需减少工作或增加能力。'}],sourceIds:['asyncRequestReply','acknowledgements','overload'],
  },
}
