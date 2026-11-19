// One-time move of the Courses page from Notion into LifeOS (copied from the page on 2026-11-19).
// Completed -> Done, Up Next -> Want, Ongoing -> In progress. The "parts" of a program go in the course's text.

export interface NotionCourse {
  title: string;
  provider?: string;
  instructor?: string;
  status: "Want" | "In progress" | "Done";
  parts?: string[];
  /** Lessons inside one of the parts, by that part's title. */
  lessons?: Record<string, string[]>;
}

/** A part is written "Course name | Instructor" (the instructor is optional). */
export function splitPart(part: string): { title: string; instructor: string } {
  const [title, ...rest] = part.split("|");
  return { title: title.trim(), instructor: rest.join("|").trim() };
}

export const NOTION_COURSES: NotionCourse[] = [
  { title: "CAPM Exam Prep Seminar - PMBOK Guide, Sixth Edition", instructor: "Joseph Phillips", provider: "Udemy", status: "Done" },
  { title: "Build Your Life Resume", instructor: "Jesse Itzler", status: "Done" },
  { title: "The Science of Well-Being", instructor: "Laurie Santos", provider: "Coursera", status: "Done" },
  {
    title: "IBM Data Science Professional Certificate",
    provider: "Coursera",
    instructor: "IBM",
    status: "Done",
    parts: [
      "What is Data Science?",
      "Tools for Data Science",
      "Data Science Methodology",
      "Python for Data Science, Al & Development",
      "Python Project for Data Science",
      "Databases and SQL for Data Science with Python",
      "Data Analysis with Python",
      "Data Visualization with Python",
      "Machine Learning with Python",
      "Applied Data Science Capstone",
    ],
  },
  { title: "Ethical Leadership Certification", provider: "NASBA Center for Public Trust", status: "Done" },
  { title: "User Experience Design Essentials - Adobe XD UI UX Design", instructor: "Daniel Scott", provider: "Udemy", status: "Done" },
  {
    title: "UX Certificate",
    provider: "CareerFoundry",
    status: "Done",
    parts: ["Intro to UX Design", "UX Immersion", "Front-End Development"],
    lessons: {
      "UX Immersion": [
        "1 - Thinking Like a User",
        "2 - Understanding the User",
        "3 - Foundational Design",
        "4 - Usability Testing",
        "5 - Refining the Design",
        "6 - End to End Design",
      ],
      "Front-End Development": ["1 - Getting Started with HTML & CSS", "2 - JavaScript & Your Portfolio Site"],
    },
  },
  { title: "Learning JIRA software", instructor: "Robert Anthony", provider: "LinkedIn Learning", status: "Done" },
  { title: "Speaking Up At Work", instructor: "Jessica Chen", provider: "LinkedIn Learning", status: "Done" },
  { title: "Finding Your Idea Hook", instructor: "Stefan Mumaw", provider: "LinkedIn Learning", status: "Done" },
  {
    title: "Become a Product Manager",
    provider: "LinkedIn Learning",
    status: "Done",
    parts: [
      "Product Management First Steps | Doug Winne",
      "Becoming a Product Manager | Cole Mercer and Evan Kimbrell",
      "Product Management: Product Strategy | Eldad Persky and Teg Grenager",
      "Product Management: Product Roadmap | Eldad Persky and Teg Grenager",
      "Product Management: Customer Development | Jay Clouse",
      "Product Innovation for Product Managers | Karen Holst",
      "Product Management: Launching Your Product | Karen Holst",
      "Technology for Product Managers | Cole Mercer",
    ],
  },
  { title: "Get Hired as a Product Manager - Applying & Interviewing", instructor: "Cole Mercer", provider: "Udemy", status: "Done" },
  { title: "Introduction to NFTs: Non-fungible Tokens", instructor: "Jonathan Reichental", provider: "LinkedIn Learning", status: "Done" },
  { title: "Pre-Programming: Everything you need to know before you code", instructor: "Evan Kimbrell", provider: "Udemy", status: "Done" },
  { title: "The Basics of Scrum", provider: "Project Management Institute", status: "Done" },
  { title: "Generative AI Overview for Project Managers", provider: "Project Management Institute", status: "Done" },
  { title: "Adobe Illustrator CC - Essentials Training", instructor: "Daniel Scott", provider: "Bring Your Own Laptop", status: "Done" },
  { title: "Adobe Lightroom CC - Essentials Training", instructor: "Daniel Scott", provider: "Bring Your Own Laptop", status: "Done" },
  { title: "Adobe Photoshop CC - Essentials Training", instructor: "Daniel Scott", provider: "Bring Your Own Laptop", status: "Done" },
  {
    title: "Adobe After Effects",
    instructor: "Daniel Scott",
    provider: "Bring Your Own Laptop",
    status: "Want",
    parts: [
      "After Effects - Learn Motion Graphic Design",
      "After Effects - Animated Infographic Video & Data Visualisation",
      "Using After Effects CC 2018, Excel and JSON to create graphs",
    ],
  },
  { title: "Adobe Premiere Pro Essentials", status: "Want" },
  { title: "Figma UI UX Design Essentials", status: "Want" },
  { title: "Investing Courses - Swing Trading / Technical Analysis", status: "In progress" },
];
