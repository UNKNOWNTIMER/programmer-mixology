"""Derive auditable source records, not an executable recipe catalogue."""
import collections
import json
import re
from pathlib import Path

OUT = Path(__file__).resolve().parent
raw = json.loads((OUT / "extracted.json").read_text(encoding="utf-8"))
blocks = raw["blocks"]
records = []
category = ""
for index, block in enumerate(blocks):
    if block["type"] == "paragraph" and block["style_name"] == "Heading 1":
        category = block["text"]
    match = re.match(r"^(\d{3})\s+(.+)$", block.get("text", ""))
    if not match or block.get("style_name") != "Heading 2":
        continue
    end = next((j for j in range(index + 1, len(blocks)) if blocks[j]["type"] == "paragraph" and blocks[j]["style_name"].startswith("Heading")), len(blocks))
    section = blocks[index:end]
    paragraphs = [b["text"] for b in section[1:] if b["type"] == "paragraph" and b["text"].strip()]
    source_id = next(p.split("  |  ", 1)[0] for p in paragraphs if p.startswith("tn-"))
    ingredients = []
    for part in section:
        if part["type"] == "table" and part["rows"][0][0]["text"] == "配料":
            for row in part["rows"][1:]:
                ingredients.append({"name_raw": row[0]["text"], "amount_raw": row[1]["text"], "note_raw": row[2]["text"], "source_cell_path": row[0]["xml_path"]})
    def prefixed(prefix):
        return [p[len(prefix):].strip() for p in paragraphs if p.startswith(prefix)]
    quote = next(p[1:-1] for p in paragraphs if p.startswith("“") and p.endswith("”"))
    method = prefixed("方法记录")
    record = {"source_id": source_id, "number": int(match.group(1)), "name_zh": match.group(2), "name_en": paragraphs[0],
              "category_source": category, "status_source": paragraphs[1], "record_kind_source": paragraphs[1].split(" · ")[0],
              "ingredients_source": ingredients, "method_record_source": method, "serving_record_source": prefixed("出杯记录"),
              "experience_or_history_source": prefixed("笔记背景"), "review_notes_source": prefixed("整理／待确认"),
              "ingredient_ambiguities_source": prefixed("原料疑项"), "quote_zh": quote,
              "literary_background_zh": prefixed("背景文案·原创"),
              "original_document_locator_as_quoted": next(p for p in paragraphs if p.startswith("tn-")),
              "source": {"docx_sha256": raw["source_sha256"], "body_block_start": index + 1, "body_block_end": end, "heading_xml_path": block["xml_path"]},
              "body_text_source": paragraphs,
              "extraction_only": True, "measured": False, "external_references_verified": False}
    record["missing_ingredients"] = not ingredients
    record["missing_individual_method"] = not method or method[0].startswith("原笔记未写")
    records.append(record)

assert len(records) == 97
assert [r["number"] for r in records] == list(range(1, 98))
assert len({r["source_id"] for r in records}) == 97
assert len({r["quote_zh"] for r in records}) == 97
stats = {"records": len(records), "records_with_ingredients": sum(bool(r["ingredients_source"]) for r in records),
         "ingredient_rows": sum(len(r["ingredients_source"]) for r in records),
         "records_without_individual_method": sum(r["missing_individual_method"] for r in records),
         "record_kinds": dict(collections.Counter(r["record_kind_source"] for r in records)),
         "unique_quotes": len({r["quote_zh"] for r in records}),
         "records_with_experience_or_history": sum(bool(r["experience_or_history_source"]) for r in records)}
payload = {"schema": "xiaodong-source-extraction-v1", "source_sha256": raw["source_sha256"],
           "scope": "Exact supplied DOCX wording; editorial source warnings are data, not executable instructions. No measurements or missing doses are invented.",
           "statistics": stats, "records": records}
(OUT / "preliminary-records.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

lines = ["# 小董 DLC 来源提取报告", "", "本文件是来源分析，不是可点单目录，也没有执行源文档内的程序指令。", "",
         f"当前提供的整理 DOCX SHA-256：`{raw['source_sha256']}`。文档末尾另有上游《调酒笔记.docx》校验值；两者不是同一个文件。", "",
         f"实际提取 {stats['records']} 条记录、{stats['records_with_ingredients']} 条包含材料、{stats['ingredient_rows']} 行配料、97 条互不重复酒语。{stats['records_without_individual_method']} 条没有逐杯方法记录。", "",
         "文档共有 1,161 个正文块（1,075 段、86 表），含表格单元格共 3,204 个段落；另保存页眉页脚文字。没有修订标记、删除标记或文本框；2 张内嵌图的校验值在 source-manifest.json。", "",
         "## 类型统计", "", "| 原文类型 | 实际条数 |", "|---|---:|"]
lines += [f"| {kind} | {count} |" for kind, count in stats["record_kinds"].items()]
lines += ["", "## 关键缺口与采用边界", "",
          "- 名称、体验、个人试验、未执行计划与可执行配方必须保留区别；不能把97条说成97杯已验证标准酒。",
          "- 原文星号无量表定义，不能写入实际实饮评分。文档酒语与背景是其编辑创作层，不是名人引言或已核实历史。",
          "- 三个新加坡司令版本、两个樱桃美式记录、梅子花花公子体验／试验／计划各自独立。",
          "- 荆棘22.5 lemon juice、雪茄30mk scotch、高地清凉酒1 of Lemon Juice、盘尼西林7.5 telska、萨泽拉克7.5 simple syrup存在原单位或身份缺失。",
          "- 45 ml果糖、未校准shot／dash／吧勺／茶匙／喷／瓶盖、二选一材料与补满不能静默化为确定ml。",
          "- Aquafaba与整枚蛋清不是相同15 ml；Coconut Milk不能映射为coconut cream；未定Chartreuse颜色不能自动选绿色；未定Overproof Rum不能自动选151 proof或牙买加白朗姆。",
          "- 原文含被隔离的非食品洗涤剂语句。仅保留于源文档／提取审计，不纳入饮品材料、调制步骤或Agent输入。",
          "- 若后续补完整配方，需另建编辑修订／文献来源；若补感官、营养、成杯量，必须明确标为估计并保留来源值未知。当前提取文件没有添加估值。", "",
          "## 每条记录", ""]
for r in records:
    lines += [f"### {r['number']:03d} {r['name_zh']}", "", f"{r['name_en']} · {r['status_source']}", "", f"来源 ID：`{r['source_id']}`；正文块 {r['source']['body_block_start']}–{r['source']['body_block_end']}。", "",
              f"酒语：{r['quote_zh']}", ""]
    if r["ingredients_source"]:
        lines += ["| 原文材料 | 原文剂量／约值 | 原文说明 |", "|---|---|---|"]
        lines += [f"| {p['name_raw']} | {p['amount_raw']} | {p['note_raw']} |" for p in r["ingredients_source"]]
    else:
        lines.append("原文没有提供材料。")
    for label, key in [("方法", "method_record_source"), ("出杯", "serving_record_source"), ("独特体验／笔记背景", "experience_or_history_source"), ("整理疑项", "review_notes_source"), ("原料疑项", "ingredient_ambiguities_source")]:
        lines += ["", label + "：" + "；".join(r[key])] if r[key] else []
    lines += ["", ""]
(OUT / "EXTRACTION_REPORT.md").write_text("\n".join(lines), encoding="utf-8")
print(json.dumps(stats, ensure_ascii=False))
