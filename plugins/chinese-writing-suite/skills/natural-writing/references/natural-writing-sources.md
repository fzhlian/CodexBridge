# 自然化写作依据与边界

## 一、经验研究

以下研究主要用于解释“机器生成文本往往存在可测的语言规律差异”，不应用来承诺任何具体文本能够规避 AI 检测；其中多项研究以英文或百科/作文体裁为主，对中文写作只能提供方法学参考，不能直接外推为确定结论。

1. Przystalski, K., Argasiński, J. K., Grabska-Gradzińska, I., & Ochab, J. K. (2025). **Stylometry recognizes human and LLM-generated texts in short samples.** arXiv:2507.00838.
   - https://arxiv.org/abs/2507.00838
   - 启示：LLM 文本可在词汇、语法、句法、标点和标准化程度上表现出稳定的文体特征。Skill 因而重点减少过度标准化和重复句法，而非随机制造错误。

2. Kendro, K., Maloney, J., & Jarvis, S. (2025). **Do LLMs produce texts with “human-like” lexical diversity?** arXiv:2508.00086.
   - https://arxiv.org/abs/2508.00086
   - 启示：LLM 与人类文本在词汇多样性多个维度上存在显著差异。Skill 应追求语境贴合的词汇选择，而非简单做同义词替换。

3. Georgiou, G. P. (2024). **Differentiating between human-written and AI-generated texts using linguistic features automatically extracted from an online computational tool.** arXiv:2407.03646.
   - https://arxiv.org/abs/2407.03646
   - 启示：人类与 AI 文本在多种词汇和句法特征上存在差异，说明自然化改写应关注语言结构整体，而不只是替换几个高频词。

4. Opara, C. (2025). **Distinguishing AI-Generated and Human-Written Text Through Psycholinguistic Analysis.** arXiv:2505.01800.
   - https://arxiv.org/abs/2505.01800
   - 启示：文体特征与词汇提取、篇章规划、认知负荷和自我监控等过程相关。Skill 因而强调语义推进、信息取舍和作者声音，而不是追求表面随机性。

## 二、理论与工程原则

- **信息功能优先。** 一句话若既不增加事实，也不承担判断、论证、衔接或情绪功能，应优先删减，而不是换一种说法保留。
- **局部连贯优先于形式对称。** 段落应围绕真实语义关系推进，不为了“三点式”“四段式”补齐结构。
- **准确性优先于多样性。** 专业术语、政策名称、数字和因果关系不得为了文体变化而替换或模糊化。
- **作者声音优先于统一风格。** 有明确原稿时，应保留原作者已存在的语气、判断力度和节奏。
- **不制造伪人类特征。** 故意错字、病句、虚构经历、无意义口语填充会降低写作质量，也没有可靠证据证明它们是“自然写作”的必要条件。

## 三、适用边界

- 这些研究并不能证明某一套中文改写规则一定让文本“像人类”，因此本 Skill 的目标定义为：**减少模板化、机械化、过度标准化表达，提高语境贴合度和作者感**。
- 不提供或承诺 AI 检测规避效果。
- 中文场景的具体语言判断仍需结合原文体裁、作者身份、受众和上下文进行人工复核。
