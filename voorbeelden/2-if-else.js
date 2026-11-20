// Code Gangen – voorbeeldlevel: if en if-else
window.LEVEL = {
  titel: 'Keuzes maken met if en else',
  code: `
int sleutels = 0;
sleutels = sleutels + 1;

if (sleutels > 0)
{
    sleutels = sleutels - 1;
}

int energie = 3;
if (energie > 5)
{
    energie = energie - 5;
}
else
{
    energie = energie + 2;
}
Console.WriteLine(energie);
`,
};
