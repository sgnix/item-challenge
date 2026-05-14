const items = [
    {
      id: "1",
      securityLevel: "secure",
      metadata: { tags: ["algebra", "functions"] },
    },
    {
      id: "2",
      securityLevel: "highly-secure",
      metadata: { tags: ["algebra"] },
    },
    {
      id: "3",
      securityLevel: "standard",
      metadata: { tags: ["algebra"] },
    },
  ];

export interface ExamItem {
  id: string;
  metadata: {
    tags: string[];
  };
  securityLevel: string; // "standard" | "secure" | "highly-secure"
}

export function mostDominantSecureTag(items: ExamItem[]): string | null {
  const secureItems = items.filter((item) => item.securityLevel === "highly-secure" || item.securityLevel === "secure");
  const votesMap = new Map<string, number>();
  
  secureItems.forEach((item) => {
    const tagsMap = new Map<string, number>();

    item.metadata.tags.forEach((tag) => {
      const t = tagsMap.get(tag);
      if (t === undefined) {
        tagsMap.set(tag, 1);
      } else {
        tagsMap.set(tag, t + 1);
      }
    })

    const arr = Array.from(tagsMap).sort((a, b) => b[1] - a[1]);
    if (arr.length === 0) return 0;

    const [tagName, count] = arr[0];

    const tagVote = votesMap.get(tagName);
    if (tagVote === undefined) {
      votesMap.set(tagName, 1);
    } else {
      votesMap.set(tagName, tagVote + 1);
    }

    arr.splice(0,1).forEach(([secondTagName, secondCount]) => {
      if (secondCount === count) {
        const tagVote = votesMap.get(secondTagName);
        if (tagVote === undefined) {
          votesMap.set(secondTagName, 1);
        } else {
          votesMap.set(secondTagName, tagVote + 1);
        }
      }
    })

  });

  const list = Array.from(votesMap).sort((a,b) => b[1] = a[1]);
  if (list.length === 0) return null;
  return list[0][0];
}

export function mostFrequentSecureTag(
  items: ExamItem[]
): string | null {
  const tagsMap = new Map<string, number>();
  const secureItems = items.filter((item) => item.securityLevel === "highly-secure" || item.securityLevel === "secure");

  secureItems.forEach((item) => {
    item.metadata.tags.forEach((tag) => {
      const t = tagsMap.get(tag);
      if (t === undefined) {
        tagsMap.set(tag, 1);
      } else {
        tagsMap.set(tag, t + 1);
      }
    });
  });

  const arr = Array.from(tagsMap);
  const sortedArr = arr.sort((a, b) => b[1] - a[1]);

  if (sortedArr.length === 0) {
    return null;
  } 

  return sortedArr[0][0];
}


console.log(mostFrequentSecureTag(items));
